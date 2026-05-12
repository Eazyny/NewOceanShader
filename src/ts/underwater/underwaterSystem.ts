import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";

export type UnderwaterSystemState = {
    enabled: boolean;
    isUnderwater: boolean;
    underwaterAmount: number;
    cameraDepthBelowSurface: number;
    waterLevel: number;
};

export type UnderwaterSystemOptions = {
    scene: Scene;
    camera: ArcRotateCamera;
    getWaterLevel: () => number;
    transitionDepth?: number;
};

function clamp01(value: number) {
    return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0: number, edge1: number, value: number) {
    const x = clamp01((value - edge0) / (edge1 - edge0));

    return x * x * (3 - 2 * x);
}

export class UnderwaterSystem {
    private readonly scene: Scene;
    private readonly camera: ArcRotateCamera;
    private readonly resolveWaterLevel: () => number;
    private readonly transitionDepth: number;

    private readonly originalClearColor: Color4;
    private readonly originalFogMode: number;
    private readonly originalFogDensity: number;
    private readonly originalFogColor: Color3;

    private enabled = true;
    private isUnderwater = false;
    private underwaterAmount = 0;
    private cameraDepthBelowSurface = 0;
    private currentWaterLevel = 0;

    constructor(options: UnderwaterSystemOptions) {
        this.scene = options.scene;
        this.camera = options.camera;
        this.resolveWaterLevel = options.getWaterLevel;
        this.transitionDepth = options.transitionDepth ?? 0.35;

        this.originalClearColor = this.scene.clearColor.clone();
        this.originalFogMode = this.scene.fogMode;
        this.originalFogDensity = this.scene.fogDensity;
        this.originalFogColor = this.scene.fogColor.clone();
    }

    public update() {
        this.currentWaterLevel = this.resolveWaterLevel();

        if (!this.enabled) {
            this.isUnderwater = false;
            this.underwaterAmount = 0;
            this.cameraDepthBelowSurface = 0;
            this.applyRenderState();

            return;
        }

        const cameraY = this.camera.globalPosition.y;

        this.cameraDepthBelowSurface = Math.max(this.currentWaterLevel - cameraY, 0);

        this.underwaterAmount = smoothstep(
            0.02,
            this.transitionDepth,
            this.cameraDepthBelowSurface
        );

        this.isUnderwater = this.underwaterAmount > 0.001;

        this.applyRenderState();
    }

    private applyRenderState() {
        const skybox = this.scene.getMeshByName("skyBox");

        if (skybox) {
            skybox.setEnabled(!this.isUnderwater);
        }

        if (this.isUnderwater) {
            const depthBlend = clamp01(this.cameraDepthBelowSurface / 12);

            /*
                More natural underwater palette:
                - shallow = blue-green / tropical teal
                - deep = darker green-blue
                This avoids the dead gray/milky look.
            */
            const shallowClear = new Color4(0.015, 0.175, 0.165, 1.0);
            const deepClear = new Color4(0.002, 0.042, 0.050, 1.0);

            const shallowFog = new Color3(0.020, 0.210, 0.195);
            const deepFog = new Color3(0.003, 0.055, 0.065);

            this.scene.clearColor = Color4.Lerp(shallowClear, deepClear, depthBlend);

            /*
                Real scene fog helps with actual geometry depth.
                This is separate from the post-process and gives the seabed
                a real distance fade instead of just screen tint.
            */
            this.scene.fogMode = Scene.FOGMODE_EXP2;
            this.scene.fogColor = Color3.Lerp(shallowFog, deepFog, depthBlend);
            this.scene.fogDensity = 0.014 + depthBlend * 0.018;
        } else {
            this.scene.clearColor = this.originalClearColor.clone();
            this.scene.fogMode = this.originalFogMode;
            this.scene.fogDensity = this.originalFogDensity;
            this.scene.fogColor = this.originalFogColor.clone();
        }
    }

    public setEnabled(enabled: boolean) {
        this.enabled = enabled;
    }

    public getState(): UnderwaterSystemState {
        return {
            enabled: this.enabled,
            isUnderwater: this.isUnderwater,
            underwaterAmount: this.underwaterAmount,
            cameraDepthBelowSurface: this.cameraDepthBelowSurface,
            waterLevel: this.currentWaterLevel
        };
    }

    public getIsUnderwater() {
        return this.isUnderwater;
    }

    public getUnderwaterAmount() {
        return this.underwaterAmount;
    }

    public getCameraDepthBelowSurface() {
        return this.cameraDepthBelowSurface;
    }

    public getCurrentWaterLevel() {
        return this.currentWaterLevel;
    }

    public dispose() {
        this.enabled = false;
        this.isUnderwater = false;
        this.underwaterAmount = 0;
        this.cameraDepthBelowSurface = 0;
        this.applyRenderState();
    }
}