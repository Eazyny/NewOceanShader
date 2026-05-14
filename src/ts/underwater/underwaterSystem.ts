import { Scene } from "@babylonjs/core/scene";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import { DepthRenderer } from "@babylonjs/core/Rendering/depthRenderer";
import { Vector3, Matrix } from "@babylonjs/core/Maths/math.vector";

import "@babylonjs/core/Rendering/depthRendererSceneComponent";

export type UnderwaterSystemOptions = {
    /**
     * The world-space still-water level.
     *
     * The FFT shader displaces the rendered water surface around this baseline.
     * Keeping a stable water level is important because camera underwater state,
     * volume fog, absorption, caustics, and buoyancy all need a common reference.
     */
    waterLevel?: number;

    /**
     * Optional callback for dynamic water level lookup.
     *
     * This is useful if your water plane or future ocean origin is not fixed at y = 0.
     */
    getWaterLevel?: () => number;

    /**
     * The render-target scale used for scene color/refraction data.
     *
     * 1.0 means full resolution.
     * Lower values can be used later for performance, but full resolution is the
     * safest starting point while stabilizing the render architecture.
     */
    renderTargetScale?: number;

    /**
     * Background color used by the scene color target.
     *
     * This should never be black for ocean rendering, because black background
     * pixels are one of the main causes of underwater horizon bands and dead
     * refraction samples.
     */
    sceneColorClearColor?: Color4;

    /**
     * Small dead-zone around the waterline.
     *
     * Without a threshold, tiny FFT motion / camera jitter can rapidly toggle
     * the system between above-water and underwater states.
     */
    waterlineTransitionWidth?: number;

    /**
     * Compatibility alias used by the current index.ts wiring.
     */
    transitionDepth?: number;
};

export type UnderwaterSystemConstructorOptions = UnderwaterSystemOptions & {
    scene: Scene;
    camera: Camera;
    engine?: AbstractEngine;
};

export type UnderwaterFrameState = {
    waterLevel: number;
    cameraPosition: Vector3;

    /**
     * Canonical depth name.
     */
    cameraDepthBelowWater: number;

    /**
     * Compatibility aliases used while the current scene file is being stabilized.
     */
    cameraDepthBelowSurface: number;
    depthBelowWater: number;
    depthBelowSurface: number;

    /**
     * Canonical underwater boolean.
     */
    isCameraUnderwater: boolean;

    /**
     * Compatibility alias.
     */
    isUnderwater: boolean;

    /**
     * Smooth 0..1 underwater blend.
     *
     * 0 = fully above water.
     * 1 = fully underwater.
     */
    submersion01: number;

    /**
     * Compatibility alias used by the current index.ts wiring.
     */
    underwaterAmount: number;

    sceneColorTexture: RenderTargetTexture;
    sceneDepthTexture: BaseTexture;
    nonWaterRenderList: AbstractMesh[];
};

export type WaterMaterialRenderStateReceiver = {
    setTexture?(name: string, texture: BaseTexture): void;
    setFloat?(name: string, value: number): void;
    setVector3?(name: string, value: Vector3): void;
    setMatrix?(name: string, value: Matrix): void;

    setSceneColorTexture?(texture: BaseTexture): void;
    setSceneDepthTexture?(texture: BaseTexture): void;
    setUnderwaterFrameState?(state: UnderwaterFrameState): void;
    applyUnderwaterFrameState?(state: UnderwaterFrameState): void;
};

export type PostProcessEffectReceiver = {
    setTexture?(name: string, texture: BaseTexture): void;
    setFloat?(name: string, value: number): void;
    setVector3?(name: string, value: Vector3): void;
    setMatrix?(name: string, value: Matrix): void;
};

type NormalizedConstructorOptions = UnderwaterSystemConstructorOptions & {
    engine: AbstractEngine;
};

export class UnderwaterSystem {
    public readonly scene: Scene;
    public readonly engine: AbstractEngine;
    public readonly camera: Camera;

    public readonly sceneColorTexture: RenderTargetTexture;
    public readonly depthRenderer: DepthRenderer;

    public waterLevel: number;
    public renderTargetScale: number;
    public waterlineTransitionWidth: number;

    private readonly getWaterLevelCallback?: () => number;

    private readonly waterMeshes = new Set<AbstractMesh>();
    private readonly excludedMeshes = new Set<AbstractMesh>();
    private readonly waterMaterials = new Set<WaterMaterialRenderStateReceiver>();
    private readonly nonWaterRenderList: AbstractMesh[] = [];

    private readonly frameStateInternal: UnderwaterFrameState;

    public constructor(options: UnderwaterSystemConstructorOptions);
    public constructor(scene: Scene, engine: AbstractEngine, camera: Camera, options?: UnderwaterSystemOptions);
    public constructor(
        sceneOrOptions: Scene | UnderwaterSystemConstructorOptions,
        engine?: AbstractEngine,
        camera?: Camera,
        options: UnderwaterSystemOptions = {}
    ) {
        const normalizedOptions = this.normalizeConstructorArguments(sceneOrOptions, engine, camera, options);

        this.scene = normalizedOptions.scene;
        this.engine = normalizedOptions.engine;
        this.camera = normalizedOptions.camera;

        this.getWaterLevelCallback = normalizedOptions.getWaterLevel;

        this.waterLevel = normalizedOptions.waterLevel ?? this.getInitialWaterLevel(normalizedOptions);
        this.renderTargetScale = normalizedOptions.renderTargetScale ?? 1;
        this.waterlineTransitionWidth =
            normalizedOptions.waterlineTransitionWidth ?? normalizedOptions.transitionDepth ?? 0.35;

        this.depthRenderer = this.scene.enableDepthRenderer(this.camera, false, true);

        this.sceneColorTexture = new RenderTargetTexture(
            "underwaterSceneColorNoWater",
            {
                width: Math.max(1, Math.floor(this.engine.getRenderWidth() * this.renderTargetScale)),
                height: Math.max(1, Math.floor(this.engine.getRenderHeight() * this.renderTargetScale))
            },
            this.scene
        );

        this.sceneColorTexture.clearColor =
            normalizedOptions.sceneColorClearColor ?? new Color4(0.42, 0.68, 0.9, 1.0);

        this.scene.customRenderTargets.push(this.sceneColorTexture);

        this.frameStateInternal = {
            waterLevel: this.waterLevel,
            cameraPosition: this.camera.globalPosition.clone(),

            cameraDepthBelowWater: 0,
            cameraDepthBelowSurface: 0,
            depthBelowWater: 0,
            depthBelowSurface: 0,

            isCameraUnderwater: false,
            isUnderwater: false,

            submersion01: 0,
            underwaterAmount: 0,

            sceneColorTexture: this.sceneColorTexture,
            sceneDepthTexture: this.depthRenderer.getDepthMap(),
            nonWaterRenderList: this.nonWaterRenderList
        };

        this.refreshRenderLists();
        this.updateCameraState();
    }

    public registerWaterMesh(mesh: AbstractMesh): void {
        this.waterMeshes.add(mesh);
        this.refreshRenderLists();
    }

    public unregisterWaterMesh(mesh: AbstractMesh): void {
        this.waterMeshes.delete(mesh);
        this.refreshRenderLists();
    }

    public registerWaterMaterial(material: WaterMaterialRenderStateReceiver): void {
        this.waterMaterials.add(material);
        this.applyToWaterMaterial(material);
    }

    public unregisterWaterMaterial(material: WaterMaterialRenderStateReceiver): void {
        this.waterMaterials.delete(material);
    }

    /**
     * Excludes a mesh from the underwater scene-color/depth support passes.
     *
     * Most scene meshes should not be excluded. This hook exists for helper meshes,
     * debug overlays, future waterline meshes, or other non-world geometry that
     * should not affect water refraction or underwater depth.
     */
    public excludeMesh(mesh: AbstractMesh): void {
        this.excludedMeshes.add(mesh);
        this.refreshRenderLists();
    }

    public includeMesh(mesh: AbstractMesh): void {
        this.excludedMeshes.delete(mesh);
        this.refreshRenderLists();
    }

    public setWaterLevel(waterLevel: number): void {
        this.waterLevel = waterLevel;
    }

    public get frameState(): UnderwaterFrameState {
        return this.frameStateInternal;
    }

    /**
     * Compatibility method for the current index/demo code.
     */
    public getState(): UnderwaterFrameState {
        return this.frameStateInternal;
    }

    public get sceneDepthTexture(): BaseTexture {
        return this.depthRenderer.getDepthMap();
    }

    public update(): UnderwaterFrameState {
        this.updateWaterLevel();
        this.refreshRenderLists();
        this.updateCameraState();

        this.frameStateInternal.waterLevel = this.waterLevel;
        this.frameStateInternal.sceneDepthTexture = this.depthRenderer.getDepthMap();

        this.applyToRegisteredWaterMaterials();

        return this.frameStateInternal;
    }

    /**
     * Pushes common render-state values into a water material-like object.
     *
     * Step 1C uses this as the bridge between the centralized render architecture
     * and the existing WaterMaterial. Phase 2 will make the shader consume more
     * of these values for proper physical optics.
     */
    public applyToWaterMaterial(material: WaterMaterialRenderStateReceiver): void {
        const state = this.frameStateInternal;

        if (material.setUnderwaterFrameState !== undefined) {
            material.setUnderwaterFrameState(state);
        } else if (material.applyUnderwaterFrameState !== undefined) {
            material.applyUnderwaterFrameState(state);
        } else {
            material.setTexture?.("textureSampler", state.sceneColorTexture);
            material.setTexture?.("depthSampler", state.sceneDepthTexture);

            material.setFloat?.("waterLevel", state.waterLevel);

            material.setFloat?.("cameraDepthBelowWater", state.cameraDepthBelowWater);
            material.setFloat?.("cameraDepthBelowSurface", state.cameraDepthBelowSurface);
            material.setFloat?.("depthBelowWater", state.depthBelowWater);
            material.setFloat?.("depthBelowSurface", state.depthBelowSurface);

            material.setFloat?.("isCameraUnderwater", state.isCameraUnderwater ? 1 : 0);
            material.setFloat?.("isUnderwater", state.isUnderwater ? 1 : 0);

            material.setFloat?.("submersion01", state.submersion01);
            material.setFloat?.("underwaterAmount", state.underwaterAmount);
        }

        material.setSceneColorTexture?.(state.sceneColorTexture);
        material.setSceneDepthTexture?.(state.sceneDepthTexture);

        material.setVector3?.("cameraPositionW", state.cameraPosition);

        material.setMatrix?.("view", this.camera.getViewMatrix());
        material.setMatrix?.("projection", this.camera.getProjectionMatrix());
        material.setMatrix?.("cameraInverseView", this.camera.getViewMatrix().clone().invert());
        material.setMatrix?.("cameraInverseProjection", this.camera.getProjectionMatrix().clone().invert());
    }

    /**
     * Pushes the same canonical underwater state to a post-process effect.
     *
     * This lets index.ts stop reconstructing ad-hoc underwater state for the
     * post-process. The current post-process shader may not consume every uniform
     * yet, but Phase 3 will.
     */
    public applyToPostProcessEffect(effect: PostProcessEffectReceiver): void {
        const state = this.frameStateInternal;

        effect.setTexture?.("depthSampler", state.sceneDepthTexture);
        effect.setTexture?.("sceneColorSampler", state.sceneColorTexture);

        effect.setFloat?.("waterLevel", state.waterLevel);

        effect.setFloat?.("cameraDepthBelowWater", state.cameraDepthBelowWater);
        effect.setFloat?.("cameraDepthBelowSurface", state.cameraDepthBelowSurface);
        effect.setFloat?.("depthBelowWater", state.depthBelowWater);
        effect.setFloat?.("depthBelowSurface", state.depthBelowSurface);

        effect.setFloat?.("isCameraUnderwater", state.isCameraUnderwater ? 1 : 0);
        effect.setFloat?.("isUnderwater", state.isUnderwater ? 1 : 0);

        effect.setFloat?.("submersion01", state.submersion01);
        effect.setFloat?.("underwaterAmount", state.underwaterAmount);

        effect.setVector3?.("cameraPosition", state.cameraPosition);
        effect.setVector3?.("cameraPositionW", state.cameraPosition);

        effect.setMatrix?.("cameraInverseView", this.camera.getViewMatrix().clone().invert());
        effect.setMatrix?.("cameraInverseProjection", this.camera.getProjectionMatrix().clone().invert());
        effect.setMatrix?.("view", this.camera.getViewMatrix());
        effect.setMatrix?.("projection", this.camera.getProjectionMatrix());
    }

    public resize(): void {
        const width = Math.max(1, Math.floor(this.engine.getRenderWidth() * this.renderTargetScale));
        const height = Math.max(1, Math.floor(this.engine.getRenderHeight() * this.renderTargetScale));

        this.sceneColorTexture.resize({
            width,
            height
        });
    }

    public dispose(): void {
        const index = this.scene.customRenderTargets.indexOf(this.sceneColorTexture);

        if (index !== -1) {
            this.scene.customRenderTargets.splice(index, 1);
        }

        this.sceneColorTexture.dispose();
        this.depthRenderer.dispose();

        this.waterMeshes.clear();
        this.excludedMeshes.clear();
        this.waterMaterials.clear();
        this.nonWaterRenderList.length = 0;
    }

    private normalizeConstructorArguments(
        sceneOrOptions: Scene | UnderwaterSystemConstructorOptions,
        engine?: AbstractEngine,
        camera?: Camera,
        options: UnderwaterSystemOptions = {}
    ): NormalizedConstructorOptions {
        if (this.isConstructorOptions(sceneOrOptions)) {
            return {
                ...sceneOrOptions,
                engine: sceneOrOptions.engine ?? sceneOrOptions.scene.getEngine()
            };
        }

        if (engine === undefined || camera === undefined) {
            throw new Error(
                "UnderwaterSystem requires either new UnderwaterSystem({ scene, camera }) or new UnderwaterSystem(scene, engine, camera)."
            );
        }

        return {
            ...options,
            scene: sceneOrOptions,
            engine,
            camera
        };
    }

    private isConstructorOptions(value: Scene | UnderwaterSystemConstructorOptions): value is UnderwaterSystemConstructorOptions {
        return (
            typeof value === "object" &&
            value !== null &&
            "scene" in value &&
            "camera" in value
        );
    }

    private getInitialWaterLevel(options: UnderwaterSystemConstructorOptions): number {
        return options.getWaterLevel?.() ?? 0;
    }

    private updateWaterLevel(): void {
        if (this.getWaterLevelCallback === undefined) return;

        this.waterLevel = this.getWaterLevelCallback();
    }

    private updateCameraState(): void {
        const cameraPosition = this.camera.globalPosition;
        const cameraDepthBelowWater = Math.max(this.waterLevel - cameraPosition.y, 0);
        const isCameraUnderwater = cameraPosition.y < this.waterLevel - this.waterlineTransitionWidth * 0.15;
        const submersion01 = this.computeSubmersion(cameraPosition.y);

        this.frameStateInternal.cameraPosition.copyFrom(cameraPosition);

        this.frameStateInternal.cameraDepthBelowWater = cameraDepthBelowWater;
        this.frameStateInternal.cameraDepthBelowSurface = cameraDepthBelowWater;
        this.frameStateInternal.depthBelowWater = cameraDepthBelowWater;
        this.frameStateInternal.depthBelowSurface = cameraDepthBelowWater;

        this.frameStateInternal.isCameraUnderwater = isCameraUnderwater;
        this.frameStateInternal.isUnderwater = isCameraUnderwater;

        this.frameStateInternal.submersion01 = submersion01;
        this.frameStateInternal.underwaterAmount = submersion01;
    }

    private applyToRegisteredWaterMaterials(): void {
        for (const material of this.waterMaterials) {
            this.applyToWaterMaterial(material);
        }
    }

    private computeSubmersion(cameraY: number): number {
        const halfWidth = Math.max(this.waterlineTransitionWidth, 0.0001);
        const signedDepth = this.waterLevel - cameraY;

        return this.smoothstep(-halfWidth, halfWidth, signedDepth);
    }

    private refreshRenderLists(): void {
        this.nonWaterRenderList.length = 0;

        for (const mesh of this.scene.meshes) {
            if (!this.shouldRenderInSupportPasses(mesh)) continue;

            this.nonWaterRenderList.push(mesh);
        }

        this.sceneColorTexture.renderList = this.nonWaterRenderList;
        this.depthRenderer.getDepthMap().renderList = this.nonWaterRenderList;
    }

    private shouldRenderInSupportPasses(mesh: AbstractMesh): boolean {
        if (this.waterMeshes.has(mesh)) return false;
        if (this.excludedMeshes.has(mesh)) return false;
        if (mesh.isDisposed()) return false;

        return true;
    }

    private smoothstep(edge0: number, edge1: number, value: number): number {
        const x = this.saturate((value - edge0) / (edge1 - edge0));

        return x * x * (3 - 2 * x);
    }

    private saturate(value: number): number {
        return Math.min(Math.max(value, 0), 1);
    }
}