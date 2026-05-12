import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import "@babylonjs/loaders/glTF";

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

type Bounds = {
    min: Vector3;
    max: Vector3;
    size: Vector3;
    center: Vector3;
};

type LoadedUnderwaterAssetOptions = {
    name: string;
    rootUrl: string;
    fileName: string;
    position: Vector3;
    rotationY?: number;
    targetSize?: number;
    lift?: number;
};

type RockScatterItem = {
    fileName: string;
    position: Vector3;
    rotationY: number;
    targetSize: number;
    lift: number;
};

function clamp01(value: number) {
    return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0: number, edge1: number, value: number) {
    const x = clamp01((value - edge0) / (edge1 - edge0));

    return x * x * (3 - 2 * x);
}

function pseudoRandom(seed: number) {
    const x = Math.sin(seed * 12.9898) * 43758.5453123;

    return x - Math.floor(x);
}

function randomRange(seed: number, min: number, max: number) {
    return min + (max - min) * pseudoRandom(seed);
}

function pickRockFile(seed: number) {
    const rockFiles = [
        "rock1.glb",
        "rock2.glb",
        "rock3.glb",
        "rock4.glb",
        "rock5.glb",
        "rock6.glb",
        "rock7.glb",
        "rock8.glb"
    ];

    const index = Math.floor(randomRange(seed, 0, rockFiles.length - 0.001));

    return rockFiles[index];
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

    private readonly underwaterRoot: TransformNode;

    private enabled = true;
    private isUnderwater = false;
    private underwaterAmount = 0;
    private cameraDepthBelowSurface = 0;
    private currentWaterLevel = 0;
    private assetsLoaded = false;

    constructor(options: UnderwaterSystemOptions) {
        this.scene = options.scene;
        this.camera = options.camera;
        this.resolveWaterLevel = options.getWaterLevel;
        this.transitionDepth = options.transitionDepth ?? 0.35;

        this.originalClearColor = this.scene.clearColor.clone();
        this.originalFogMode = this.scene.fogMode;
        this.originalFogDensity = this.scene.fogDensity;
        this.originalFogColor = this.scene.fogColor.clone();

        this.underwaterRoot = new TransformNode("underwaterEnvironmentRoot", this.scene);
        this.underwaterRoot.setEnabled(false);

        void this.loadInitialAssets();
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

    private getSeabedY() {
        const ground = this.scene.getMeshByName("ground");

        return ground ? ground.position.y : -10;
    }

    private createRockScatterLayout(seabedY: number): RockScatterItem[] {
        const rocks: RockScatterItem[] = [];

        /*
            Hand-placed foreground/midground rocks first.
            These are intentionally visible near the starting underwater camera.
        */
        rocks.push(
            {
                fileName: "rock1.glb",
                position: new Vector3(-6, seabedY, 13),
                rotationY: Math.PI * 0.12,
                targetSize: 3.5,
                lift: 0.05
            },
            {
                fileName: "rock4.glb",
                position: new Vector3(4, seabedY, 15),
                rotationY: Math.PI * 0.45,
                targetSize: 6.5,
                lift: 0.06
            },
            {
                fileName: "rock7.glb",
                position: new Vector3(-15, seabedY, 24),
                rotationY: Math.PI * 0.72,
                targetSize: 8.5,
                lift: 0.08
            },
            {
                fileName: "rock_large.glb",
                position: new Vector3(16, seabedY, 30),
                rotationY: Math.PI * 0.22,
                targetSize: 13.0,
                lift: 0.08
            }
        );

        /*
            Procedural scatter:
            small/medium rocks across a wider area.
            Not too many yet. We want to judge composition/performance first.
        */
        for (let i = 0; i < 18; i++) {
            const seed = i + 1;

            const x = randomRange(seed * 3.1, -55, 55);
            const z = randomRange(seed * 7.7, 18, 95);

            const isSmall = i % 3 === 0;
            const isLarge = i % 7 === 0;

            let targetSize = randomRange(seed * 5.3, 4.5, 7.5);

            if (isSmall) {
                targetSize = randomRange(seed * 4.6, 2.6, 4.2);
            }

            if (isLarge) {
                targetSize = randomRange(seed * 6.9, 8.0, 11.0);
            }

            rocks.push({
                fileName: pickRockFile(seed * 9.2),
                position: new Vector3(x, seabedY, z),
                rotationY: randomRange(seed * 11.5, 0, Math.PI * 2),
                targetSize,
                lift: randomRange(seed * 2.4, 0.03, 0.10)
            });
        }

        /*
            A few distant hero silhouettes.
            These help the underwater fog feel deeper once we tune color.
        */
        rocks.push(
            {
                fileName: "rock_large.glb",
                position: new Vector3(-40, seabedY, 105),
                rotationY: Math.PI * 0.65,
                targetSize: 15.0,
                lift: 0.10
            },
            {
                fileName: "rock8.glb",
                position: new Vector3(42, seabedY, 115),
                rotationY: Math.PI * 0.18,
                targetSize: 12.0,
                lift: 0.08
            }
        );

        return rocks;
    }

    private async loadInitialAssets() {
        if (this.assetsLoaded) return;

        this.assetsLoaded = true;

        const seabedY = this.getSeabedY();
        const rockScatter = this.createRockScatterLayout(seabedY);

        try {
            for (let i = 0; i < rockScatter.length; i++) {
                const rock = rockScatter[i];

                await this.loadAsset({
                    name: `underwaterRock_${i + 1}_${rock.fileName.replace(".glb", "")}`,
                    rootUrl: "/models/underwater/rocks/",
                    fileName: rock.fileName,
                    position: rock.position,
                    rotationY: rock.rotationY,
                    targetSize: rock.targetSize,
                    lift: rock.lift
                });
            }

            console.log(`[UnderwaterSystem] Rock scatter loaded: ${rockScatter.length} rocks.`);
        } catch (error) {
            console.error("[UnderwaterSystem] Failed to load underwater rock asset:", error);
        }

        this.applyRenderState();
    }

    private async loadAsset(options: LoadedUnderwaterAssetOptions) {
        const assetRoot = new TransformNode(options.name, this.scene);

        assetRoot.parent = this.underwaterRoot;
        assetRoot.position = Vector3.Zero();
        assetRoot.rotation.y = options.rotationY ?? 0;
        assetRoot.scaling = new Vector3(1, 1, 1);

        const result = await SceneLoader.ImportMeshAsync(
            "",
            options.rootUrl,
            options.fileName,
            this.scene
        );

        const importedMeshes = result.meshes.filter((mesh) => {
            return mesh instanceof AbstractMesh && mesh.getTotalVertices() > 0;
        }) as AbstractMesh[];

        const importedNodes = [...result.meshes, ...result.transformNodes] as Array<any>;
        const importedNodeSet = new Set(importedNodes);

        const topLevelNodes = importedNodes.filter((node) => {
            return !node.parent || !importedNodeSet.has(node.parent);
        });

        /*
            Keep the GLB hierarchy intact, but parent it under our own root.
        */
        topLevelNodes.forEach((node) => {
            node.parent = assetRoot;
        });

        importedMeshes.forEach((mesh) => {
            mesh.isPickable = false;
            mesh.receiveShadows = false;
            mesh.visibility = 1;
            mesh.setEnabled(true);

            /*
                No debug material.
                Let the GLB use its own material/texture.
            */
            mesh.showBoundingBox = false;
        });

        this.normalizeAssetToPosition(assetRoot, importedMeshes, options);

        const bounds = this.getMeshBounds(importedMeshes);

        console.log(`[UnderwaterSystem] Loaded ${options.fileName}`, {
            name: options.name,
            meshCount: importedMeshes.length,
            vertices: importedMeshes.reduce((total, mesh) => total + mesh.getTotalVertices(), 0),
            indices: importedMeshes.reduce((total, mesh) => total + mesh.getTotalIndices(), 0),
            targetSize: options.targetSize,
            bounds: bounds
                ? {
                      size: bounds.size.toString(),
                      center: bounds.center.toString()
                  }
                : "No valid bounds"
        });

        return assetRoot;
    }

    private normalizeAssetToPosition(
        assetRoot: TransformNode,
        meshes: AbstractMesh[],
        options: LoadedUnderwaterAssetOptions
    ) {
        assetRoot.computeWorldMatrix(true);

        let bounds = this.getMeshBounds(meshes);

        if (!bounds) {
            assetRoot.position = options.position.clone();
            return;
        }

        const targetSize = options.targetSize ?? 5;
        const largestDimension = Math.max(bounds.size.x, bounds.size.y, bounds.size.z);

        if (largestDimension > 0.0001) {
            const scaleFactor = targetSize / largestDimension;

            assetRoot.scaling = new Vector3(scaleFactor, scaleFactor, scaleFactor);
            assetRoot.computeWorldMatrix(true);

            meshes.forEach((mesh) => {
                mesh.computeWorldMatrix(true);
                mesh.refreshBoundingInfo({});
            });
        }

        bounds = this.getMeshBounds(meshes);

        if (!bounds) {
            assetRoot.position = options.position.clone();
            return;
        }

        const lift = options.lift ?? 0;

        /*
            Center X/Z around desired position.
            Place bottom on seabed + lift.
        */
        const moveX = options.position.x - bounds.center.x;
        const moveY = options.position.y + lift - bounds.min.y;
        const moveZ = options.position.z - bounds.center.z;

        assetRoot.position.addInPlace(new Vector3(moveX, moveY, moveZ));
        assetRoot.computeWorldMatrix(true);

        meshes.forEach((mesh) => {
            mesh.computeWorldMatrix(true);
            mesh.refreshBoundingInfo({});
        });
    }

    private getMeshBounds(meshes: AbstractMesh[]): Bounds | null {
        let min = new Vector3(
            Number.POSITIVE_INFINITY,
            Number.POSITIVE_INFINITY,
            Number.POSITIVE_INFINITY
        );

        let max = new Vector3(
            Number.NEGATIVE_INFINITY,
            Number.NEGATIVE_INFINITY,
            Number.NEGATIVE_INFINITY
        );

        let foundValidBounds = false;

        meshes.forEach((mesh) => {
            if (mesh.getTotalVertices() <= 0) return;

            mesh.computeWorldMatrix(true);
            mesh.refreshBoundingInfo({});

            const boundingBox = mesh.getBoundingInfo().boundingBox;

            min = Vector3.Minimize(min, boundingBox.minimumWorld);
            max = Vector3.Maximize(max, boundingBox.maximumWorld);

            foundValidBounds = true;
        });

        if (!foundValidBounds) return null;

        const size = max.subtract(min);
        const center = min.add(size.scale(0.5));

        return {
            min,
            max,
            size,
            center
        };
    }

    private applyRenderState() {
        const skybox = this.scene.getMeshByName("skyBox");

        if (skybox) {
            skybox.setEnabled(!this.isUnderwater);
        }

        this.underwaterRoot.setEnabled(this.isUnderwater);

        if (this.isUnderwater) {
            const depthBlend = clamp01(this.cameraDepthBelowSurface / 14);

            const shallowClear = new Color4(0.010, 0.165, 0.165, 1.0);
            const midClear = new Color4(0.006, 0.105, 0.120, 1.0);
            const deepClear = new Color4(0.002, 0.038, 0.052, 1.0);

            const shallowFog = new Color3(0.018, 0.185, 0.175);
            const midFog = new Color3(0.010, 0.120, 0.125);
            const deepFog = new Color3(0.003, 0.045, 0.060);

            const clearA = Color4.Lerp(shallowClear, midClear, clamp01(depthBlend * 1.35));
            const clearB = Color4.Lerp(midClear, deepClear, clamp01((depthBlend - 0.35) / 0.65));
            const fogA = Color3.Lerp(shallowFog, midFog, clamp01(depthBlend * 1.35));
            const fogB = Color3.Lerp(midFog, deepFog, clamp01((depthBlend - 0.35) / 0.65));

            this.scene.clearColor = depthBlend < 0.35 ? clearA : clearB;
            this.scene.fogMode = Scene.FOGMODE_EXP2;
            this.scene.fogColor = depthBlend < 0.35 ? fogA : fogB;

            /*
                Still light enough to judge the rock scatter.
                We'll push this darker/deeper once scatter feels right.
            */
            this.scene.fogDensity = 0.0012 + depthBlend * 0.0038;
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
        this.underwaterRoot.dispose();
        this.applyRenderState();
    }
}