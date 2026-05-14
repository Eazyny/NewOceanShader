import fragment from "../shaders/waterMaterial/fragment.glsl";
import vertex from "../shaders/waterMaterial/vertex.glsl";

import { Scene } from "@babylonjs/core/scene";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import { IFFT } from "./utils/IFFT";
import { createStorageTexture } from "./utils/utils";
import { DynamicSpectrum } from "./spectrum/dynamicSpectrum";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { Effect } from "@babylonjs/core/Materials/effect";
import { Constants } from "@babylonjs/core/Engines/constants";
import { InitialSpectrum } from "./spectrum/initialSpectrum";
import { CubeTexture } from "@babylonjs/core/Materials/Textures/cubeTexture";
import { DepthRenderer } from "@babylonjs/core/Rendering/depthRenderer";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";

import "@babylonjs/core/Rendering/depthRendererSceneComponent";

import TropicalSunnyDay_px from "../assets/skybox/TropicalSunnyDay_px.jpg";
import TropicalSunnyDay_py from "../assets/skybox/TropicalSunnyDay_py.jpg";
import TropicalSunnyDay_pz from "../assets/skybox/TropicalSunnyDay_pz.jpg";
import TropicalSunnyDay_nx from "../assets/skybox/TropicalSunnyDay_nx.jpg";
import TropicalSunnyDay_ny from "../assets/skybox/TropicalSunnyDay_ny.jpg";
import TropicalSunnyDay_nz from "../assets/skybox/TropicalSunnyDay_nz.jpg";

export type WaterMaterialFrameState = {
    waterLevel?: number;
    cameraDepthBelowWater?: number;
    cameraDepthBelowSurface?: number;
    depthBelowWater?: number;
    depthBelowSurface?: number;
    isCameraUnderwater?: boolean;
    isUnderwater?: boolean;
    submersion01?: number;
    underwaterAmount?: number;
    sceneColorTexture?: BaseTexture;
    sceneDepthTexture?: BaseTexture;
};

/**
 * The material that renders the FFT ocean surface.
 *
 * This class owns the FFT simulation textures because those are part of the
 * water surface itself. The higher-level UnderwaterSystem owns the shared
 * scene color/depth support passes and pushes those textures/state into this
 * material.
 */
export class WaterMaterial extends ShaderMaterial {
    /**
     * The size of the textures used in the simulation. Higher values are more accurate but slower to compute.
     */
    readonly textureSize: number;

    /**
     * The size of the ocean tiles.
     */
    readonly tileSize: number;

    readonly reflectionTexture: CubeTexture;

    /**
     * Wave shaping settings.
     * These are intentionally simple knobs so we can tune the look without touching the FFT pipeline every time.
     */
    readonly settings = {
        waveHeightScale: 0.62,
        choppinessScale: 0.78,
        normalStrength: 0.82
    };

    /**
     * The spectrum describing the simulation at time t=0.
     */
    readonly initialSpectrum: InitialSpectrum;

    /**
     * The spectrum describing the simulation at the current time.
     */
    readonly dynamicSpectrum: DynamicSpectrum;

    /**
     * The IFFT calculator used to compute the height map, gradient map and displacement map.
     */
    readonly ifft: IFFT;

    /**
     * The height map is used to translate vertically the water vertices.
     * It is computed using the IFFT of the dynamic spectrum.
     */
    readonly heightMap: BaseTexture;

    /**
     * The gradient map is used to compute the normals of the water mesh in order to shade it properly.
     * It is computed using the IFFT of the dynamic spectrum.
     */
    readonly gradientMap: BaseTexture;

    /**
     * The displacement map is used to achieve the "Choppy waves" effect described in Tessendorf's paper.
     * It helps to make sharper wave crests and smoother troughs.
     * It is computed using the IFFT of the dynamic spectrum.
     */
    readonly displacementMap: BaseTexture;

    /**
     * Fallback depth renderer used only when an external underwater/ocean render
     * pipeline has not supplied a depth texture yet.
     */
    readonly depthRenderer: DepthRenderer;

    /**
     * Fallback scene-color target used only when an external underwater/ocean
     * render pipeline has not supplied a scene color texture yet.
     */
    readonly screenRenderTarget: RenderTargetTexture;

    private usesExternalSceneColorTexture = false;
    private usesExternalDepthTexture = false;

    private readonly fallbackRenderList: AbstractMesh[] = [];

    private waterLevel = 0;
    private cameraDepthBelowWater = 0;
    private isCameraUnderwater = false;
    private submersion01 = 0;

    /**
     * Water shader debug output mode.
     *
     * 0 = final shaded water
     * 1 = raw depth
     * 2 = estimated depth delta
     * 3 = estimated water thickness
     * 4 = background/no-depth mask
     * 5 = Fresnel
     * 6 = underwater amount
     */
    private waterDebugMode = 0;

    /**
     * The elapsed time in seconds since the simulation started.
     * Starting at 0 creates some visual artefacts, so we start at 1 min to avoid them.
     */
    private elapsedSeconds = 60;

    constructor(name: string, initialSpectrum: InitialSpectrum, scene: Scene, engine: WebGPUEngine) {
        if (Effect.ShadersStore["oceanVertexShader"] === undefined) {
            Effect.ShadersStore["oceanVertexShader"] = vertex;
        }
        if (Effect.ShadersStore["oceanFragmentShader"] === undefined) {
            Effect.ShadersStore["oceanFragmentShader"] = fragment;
        }

        super(name, scene, "ocean", {
            attributes: ["position", "normal", "uv"],
            uniforms: [
                "world",
                "worldView",
                "worldViewProjection",
                "view",
                "projection",
                "cameraInverseView",
                "cameraInverseProjection",
                "cameraPositionW",
                "lightDirection",
                "tileSize",
                "waveHeightScale",
                "choppinessScale",
                "normalStrength",
                "time",
                "waterLevel",
                "cameraDepthBelowWater",
                "cameraDepthBelowSurface",
                "depthBelowWater",
                "depthBelowSurface",
                "isCameraUnderwater",
                "isUnderwater",
                "submersion01",
                "underwaterAmount",
                "waterDebugMode"
            ],
            samplers: [
                "heightMap",
                "gradientMap",
                "displacementMap",
                "reflectionSampler",
                "depthSampler",
                "textureSampler"
            ]
        });

        this.depthRenderer = scene.enableDepthRenderer(scene.activeCamera, false, true);
        this.setTexture("depthSampler", this.depthRenderer.getDepthMap());

        this.screenRenderTarget = new RenderTargetTexture(
            "screenTexture",
            {
                width: Math.max(1, engine.getRenderWidth()),
                height: Math.max(1, engine.getRenderHeight())
            },
            scene
        );

        scene.customRenderTargets.push(this.screenRenderTarget);
        this.setTexture("textureSampler", this.screenRenderTarget);

        this.reflectionTexture = new CubeTexture("", scene, null, false, [
            TropicalSunnyDay_px,
            TropicalSunnyDay_py,
            TropicalSunnyDay_pz,
            TropicalSunnyDay_nx,
            TropicalSunnyDay_ny,
            TropicalSunnyDay_nz
        ]);

        this.setTexture("reflectionSampler", this.reflectionTexture);

        if (initialSpectrum.h0.textureFormat != Constants.TEXTUREFORMAT_RGBA) {
            throw new Error("The base spectrum must have a texture format of RGBA");
        }

        this.textureSize = initialSpectrum.textureSize;
        this.tileSize = initialSpectrum.tileSize;

        this.initialSpectrum = initialSpectrum;
        this.dynamicSpectrum = new DynamicSpectrum(this.initialSpectrum, engine);

        this.ifft = new IFFT(engine, this.textureSize);
        this.heightMap = createStorageTexture("heightBuffer", engine, this.textureSize, this.textureSize, Constants.TEXTUREFORMAT_RG);
        this.gradientMap = createStorageTexture("gradientBuffer", engine, this.textureSize, this.textureSize, Constants.TEXTUREFORMAT_RG);
        this.displacementMap = createStorageTexture("displacementBuffer", engine, this.textureSize, this.textureSize, Constants.TEXTUREFORMAT_RG);

        this.setTexture("heightMap", this.heightMap);
        this.setTexture("gradientMap", this.gradientMap);
        this.setTexture("displacementMap", this.displacementMap);

        this.setFloat("waveHeightScale", this.settings.waveHeightScale);
        this.setFloat("choppinessScale", this.settings.choppinessScale);
        this.setFloat("normalStrength", this.settings.normalStrength);

        this.syncWaterStateUniforms();
        this.syncDebugUniforms();
    }

    /**
     * Supplies the scene color texture used by the water shader for refraction.
     */
    public setSceneColorTexture(texture: BaseTexture): void {
        this.usesExternalSceneColorTexture = true;
        this.setTexture("textureSampler", texture);
    }

    /**
     * Supplies the scene depth texture used by the water shader.
     */
    public setSceneDepthTexture(texture: BaseTexture): void {
        this.usesExternalDepthTexture = true;
        this.setTexture("depthSampler", texture);
    }

    /**
     * Applies the frame state produced by UnderwaterSystem.
     */
    public setUnderwaterFrameState(state: WaterMaterialFrameState): void {
        if (state.sceneColorTexture !== undefined) {
            this.setSceneColorTexture(state.sceneColorTexture);
        }

        if (state.sceneDepthTexture !== undefined) {
            this.setSceneDepthTexture(state.sceneDepthTexture);
        }

        if (state.waterLevel !== undefined) {
            this.waterLevel = state.waterLevel;
        }

        const resolvedDepth =
            state.cameraDepthBelowWater ??
            state.cameraDepthBelowSurface ??
            state.depthBelowWater ??
            state.depthBelowSurface;

        if (resolvedDepth !== undefined) {
            this.cameraDepthBelowWater = resolvedDepth;
        }

        const resolvedUnderwater =
            state.isCameraUnderwater ??
            state.isUnderwater;

        if (resolvedUnderwater !== undefined) {
            this.isCameraUnderwater = resolvedUnderwater;
        }

        const resolvedSubmersion =
            state.submersion01 ??
            state.underwaterAmount;

        if (resolvedSubmersion !== undefined) {
            this.submersion01 = resolvedSubmersion;
        }

        this.syncWaterStateUniforms();
    }

    /**
     * Compatibility helper for systems that want to apply both textures and
     * water-state in one call.
     */
    public applyUnderwaterFrameState(state: WaterMaterialFrameState): void {
        this.setUnderwaterFrameState(state);
    }

    /**
     * Clears externally supplied support textures and returns the material to its
     * original fallback behavior.
     */
    public useFallbackSupportTextures(): void {
        this.usesExternalSceneColorTexture = false;
        this.usesExternalDepthTexture = false;

        this.setTexture("textureSampler", this.screenRenderTarget);
        this.setTexture("depthSampler", this.depthRenderer.getDepthMap());
    }

    public setDebugMode(mode: number): void {
        this.waterDebugMode = Math.max(0, Math.floor(mode));
        this.syncDebugUniforms();
    }

    public getDebugMode(): number {
        return this.waterDebugMode;
    }

    public cycleDebugMode(maxMode = 6): number {
        const safeMaxMode = Math.max(0, Math.floor(maxMode));
        const nextMode = this.waterDebugMode >= safeMaxMode ? 0 : this.waterDebugMode + 1;

        this.setDebugMode(nextMode);

        return this.waterDebugMode;
    }

    /**
     * Update the material with the new state of the ocean simulation.
     * IFFT will be used to compute the height map, gradient map and displacement map for the current time.
     * @param deltaSeconds The time elapsed since the last update in seconds
     * @param lightDirection The direction of the light in the scene
     */
    public update(deltaSeconds: number, lightDirection: Vector3) {
        this.elapsedSeconds += deltaSeconds;
        this.dynamicSpectrum.generate(this.elapsedSeconds);

        this.updateFallbackRenderLists();

        this.ifft.applyToTexture(this.dynamicSpectrum.ht, this.heightMap);
        this.ifft.applyToTexture(this.dynamicSpectrum.dht, this.gradientMap);
        this.ifft.applyToTexture(this.dynamicSpectrum.displacement, this.displacementMap);

        const activeCamera = this.getScene().activeCamera;
        if (activeCamera === null) throw new Error("No active camera found");

        this.setVector3("cameraPositionW", activeCamera.globalPosition);

        this.setFloat("tileSize", this.tileSize);
        this.setFloat("waveHeightScale", this.settings.waveHeightScale);
        this.setFloat("choppinessScale", this.settings.choppinessScale);
        this.setFloat("normalStrength", this.settings.normalStrength);

        this.setFloat("time", this.elapsedSeconds);
        this.syncWaterStateUniforms();
        this.syncDebugUniforms();

        this.setMatrix("view", activeCamera.getViewMatrix());
        this.setMatrix("projection", activeCamera.getProjectionMatrix());
        this.setMatrix("cameraInverseView", activeCamera.getViewMatrix().clone().invert());
        this.setMatrix("cameraInverseProjection", activeCamera.getProjectionMatrix().clone().invert());

        this.setVector3("lightDirection", lightDirection);
    }

    public resizeSupportTextures(width: number, height: number): void {
        this.screenRenderTarget.resize({
            width: Math.max(1, Math.floor(width)),
            height: Math.max(1, Math.floor(height))
        });
    }

    public dispose(forceDisposeEffect?: boolean, forceDisposeTextures?: boolean, notBoundToMesh?: boolean) {
        const scene = this.getScene();
        const customTargetIndex = scene.customRenderTargets.indexOf(this.screenRenderTarget);

        if (customTargetIndex !== -1) {
            scene.customRenderTargets.splice(customTargetIndex, 1);
        }

        this.dynamicSpectrum.dispose();
        this.ifft.dispose();
        this.heightMap.dispose();
        this.gradientMap.dispose();
        this.displacementMap.dispose();

        if (forceDisposeTextures) {
            this.reflectionTexture.dispose();
            this.screenRenderTarget.dispose();
        }

        super.dispose(forceDisposeEffect, forceDisposeTextures, notBoundToMesh);
    }

    private syncWaterStateUniforms(): void {
        this.setFloat("waterLevel", this.waterLevel);

        this.setFloat("cameraDepthBelowWater", this.cameraDepthBelowWater);
        this.setFloat("cameraDepthBelowSurface", this.cameraDepthBelowWater);
        this.setFloat("depthBelowWater", this.cameraDepthBelowWater);
        this.setFloat("depthBelowSurface", this.cameraDepthBelowWater);

        this.setFloat("isCameraUnderwater", this.isCameraUnderwater ? 1 : 0);
        this.setFloat("isUnderwater", this.isCameraUnderwater ? 1 : 0);

        this.setFloat("submersion01", this.submersion01);
        this.setFloat("underwaterAmount", this.submersion01);
    }

    private syncDebugUniforms(): void {
        this.setFloat("waterDebugMode", this.waterDebugMode);
    }

    private updateFallbackRenderLists(): void {
        if (this.usesExternalSceneColorTexture && this.usesExternalDepthTexture) return;

        this.fallbackRenderList.length = 0;

        for (const mesh of this.getScene().meshes) {
            if (mesh.material === this) continue;
            if (mesh.isDisposed()) continue;

            this.fallbackRenderList.push(mesh);
        }

        if (!this.usesExternalDepthTexture) {
            this.depthRenderer.getDepthMap().renderList = this.fallbackRenderList;
        }

        if (!this.usesExternalSceneColorTexture) {
            this.screenRenderTarget.renderList = this.fallbackRenderList;
        }
    }
}