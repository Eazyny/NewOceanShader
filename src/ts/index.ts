import "../styles/index.css";

import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import "@babylonjs/core/Loading/loadingScreen";
import { WebGPUEngine } from "@babylonjs/core/Engines";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";

import { WaterMaterial } from "./waterMaterial";
import { PhillipsSpectrum } from "./spectrum/phillipsSpectrum";
import { UnderwaterSystem } from "./underwater/underwaterSystem";

import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { PostProcess } from "@babylonjs/core/PostProcesses/postProcess";
import { Effect } from "@babylonjs/core/Materials/effect";

import "@babylonjs/core/Rendering/depthRendererSceneComponent";

import postProcessCode from "../shaders/smallPostProcess.glsl";

type CameraMode = "orbit" | "fly" | "boat";

type PerformanceHudElements = {
    root: HTMLDivElement;
    fps: HTMLElement;
    frame: HTMLElement;
    draws: HTMLElement;
    tris: HTMLElement;
    dpr: HTMLElement;
    orbitMode: HTMLElement;
    flyMode: HTMLElement;
    boatMode: HTMLElement;
    moveRow: HTMLElement;
    verticalRow: HTMLElement;
    underwaterState: HTMLElement;
    underwaterDepth: HTMLElement;
    underwaterAmount: HTMLElement;
};

type ActiveMeshCollection = {
    length: number;
    data: AbstractMesh[];
};

function injectPerformanceHudStyles() {
    if (document.getElementById("ocean-performance-hud-styles")) return;

    const style = document.createElement("style");
    style.id = "ocean-performance-hud-styles";

    style.textContent = `
        .ocean-performance-hud {
            position: fixed;
            top: 14px;
            left: 14px;
            width: 218px;
            z-index: 9999;
            padding: 18px;
            border-radius: 16px;
            color: rgba(235, 250, 255, 0.96);
            background:
                linear-gradient(180deg, rgba(37, 88, 132, 0.84), rgba(17, 55, 78, 0.88));
            border: 1px solid rgba(170, 230, 255, 0.16);
            box-shadow:
                0 18px 60px rgba(0, 0, 0, 0.32),
                inset 0 1px 0 rgba(255, 255, 255, 0.08);
            backdrop-filter: blur(14px);
            -webkit-backdrop-filter: blur(14px);
            font-family:
                ui-monospace,
                SFMono-Regular,
                Menlo,
                Monaco,
                Consolas,
                "Liberation Mono",
                "Courier New",
                monospace;
            font-size: 13px;
            line-height: 1;
            user-select: none;
            pointer-events: auto;
        }

        .ocean-performance-hud__section {
            display: grid;
            gap: 14px;
        }

        .ocean-performance-hud__section + .ocean-performance-hud__section {
            margin-top: 18px;
            padding-top: 18px;
            border-top: 1px solid rgba(210, 245, 255, 0.14);
        }

        .ocean-performance-hud__row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
        }

        .ocean-performance-hud__label {
            color: rgba(215, 235, 245, 0.72);
            font-weight: 700;
        }

        .ocean-performance-hud__value {
            color: rgba(255, 255, 255, 0.98);
            font-weight: 900;
            letter-spacing: -0.03em;
        }

        .ocean-performance-hud__title {
            margin-bottom: 2px;
            color: rgba(200, 225, 235, 0.44);
            font-weight: 900;
            text-transform: uppercase;
            letter-spacing: 0.035em;
        }

        .ocean-performance-hud__active {
            color: rgba(115, 220, 255, 0.98);
            font-weight: 900;
        }

        .ocean-performance-hud__inactive {
            color: rgba(210, 235, 245, 0.34);
            font-weight: 800;
        }

        .ocean-performance-hud__mode {
            cursor: pointer;
            border-radius: 8px;
            margin: -5px -7px;
            padding: 5px 7px;
            transition:
                background 160ms ease,
                color 160ms ease;
        }

        .ocean-performance-hud__mode:hover {
            background: rgba(255, 255, 255, 0.07);
        }

        .ocean-performance-hud__button {
            margin-top: 18px;
            width: 38px;
            height: 38px;
            display: grid;
            place-items: center;
            border-radius: 10px;
            color: rgba(230, 250, 255, 0.86);
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(210, 245, 255, 0.18);
            cursor: pointer;
            font: inherit;
            transition:
                transform 160ms ease,
                background 160ms ease,
                border-color 160ms ease;
        }

        .ocean-performance-hud__button:hover {
            transform: translateY(-1px);
            background: rgba(255, 255, 255, 0.13);
            border-color: rgba(210, 245, 255, 0.3);
        }

        .ocean-performance-hud.is-compact {
            width: auto;
            padding: 12px;
        }

        .ocean-performance-hud.is-compact .ocean-performance-hud__section {
            display: none;
        }

        .ocean-performance-hud.is-compact .ocean-performance-hud__button {
            margin-top: 0;
        }

        @media (max-width: 720px) {
            .ocean-performance-hud {
                top: 10px;
                left: 10px;
                width: 190px;
                padding: 14px;
                font-size: 12px;
            }
        }
    `;

    document.head.appendChild(style);
}

function createPerformanceHud(): PerformanceHudElements {
    injectPerformanceHudStyles();

    const root = document.createElement("div");
    root.className = "ocean-performance-hud";

    root.innerHTML = `
        <div class="ocean-performance-hud__section">
            <div class="ocean-performance-hud__row">
                <span class="ocean-performance-hud__label">GPU</span>
                <span class="ocean-performance-hud__value">WebGPU</span>
            </div>

            <div class="ocean-performance-hud__row">
                <span class="ocean-performance-hud__label">FPS</span>
                <span class="ocean-performance-hud__value" data-hud="fps">0</span>
            </div>

            <div class="ocean-performance-hud__row">
                <span class="ocean-performance-hud__label">Frame</span>
                <span class="ocean-performance-hud__value" data-hud="frame">0 ms</span>
            </div>

            <div class="ocean-performance-hud__row">
                <span class="ocean-performance-hud__label">Draws</span>
                <span class="ocean-performance-hud__value" data-hud="draws">0</span>
            </div>

            <div class="ocean-performance-hud__row">
                <span class="ocean-performance-hud__label">Tris</span>
                <span class="ocean-performance-hud__value" data-hud="tris">0</span>
            </div>

            <div class="ocean-performance-hud__row">
                <span class="ocean-performance-hud__label">DPR</span>
                <span class="ocean-performance-hud__value" data-hud="dpr">1.00</span>
            </div>
        </div>

        <div class="ocean-performance-hud__section">
            <div class="ocean-performance-hud__title">Free Camera</div>

            <div class="ocean-performance-hud__row ocean-performance-hud__mode" data-camera-mode="orbit">
                <span data-camera-label="orbit">Orbit</span>
                <span data-camera-number="orbit">1</span>
            </div>

            <div class="ocean-performance-hud__row ocean-performance-hud__mode" data-camera-mode="fly">
                <span data-camera-label="fly">Fly</span>
                <span data-camera-number="fly">2</span>
            </div>

            <div class="ocean-performance-hud__row ocean-performance-hud__mode" data-camera-mode="boat">
                <span data-camera-label="boat">Boat</span>
                <span data-camera-number="boat">3</span>
            </div>
        </div>

        <div class="ocean-performance-hud__section">
            <div class="ocean-performance-hud__row">
                <span class="ocean-performance-hud__active">Orbit</span>
                <span class="ocean-performance-hud__inactive">LMB</span>
            </div>

            <div class="ocean-performance-hud__row">
                <span class="ocean-performance-hud__value">Pan</span>
                <span class="ocean-performance-hud__inactive">RMB</span>
            </div>

            <div class="ocean-performance-hud__row">
                <span class="ocean-performance-hud__value">Zoom</span>
                <span class="ocean-performance-hud__inactive">Scroll</span>
            </div>

            <div class="ocean-performance-hud__row" data-hud="move-row">
                <span class="ocean-performance-hud__value">Move</span>
                <span class="ocean-performance-hud__inactive">WASD</span>
            </div>

            <div class="ocean-performance-hud__row" data-hud="vertical-row">
                <span class="ocean-performance-hud__value">Height</span>
                <span class="ocean-performance-hud__inactive">Q / E</span>
            </div>
        </div>

        <div class="ocean-performance-hud__section">
            <div class="ocean-performance-hud__title">Underwater</div>

            <div class="ocean-performance-hud__row">
                <span class="ocean-performance-hud__label">State</span>
                <span class="ocean-performance-hud__value" data-hud="underwater-state">NO</span>
            </div>

            <div class="ocean-performance-hud__row">
                <span class="ocean-performance-hud__label">Depth</span>
                <span class="ocean-performance-hud__value" data-hud="underwater-depth">0.00</span>
            </div>

            <div class="ocean-performance-hud__row">
                <span class="ocean-performance-hud__label">Amount</span>
                <span class="ocean-performance-hud__value" data-hud="underwater-amount">0.00</span>
            </div>
        </div>

        <button class="ocean-performance-hud__button" type="button" aria-label="Toggle performance HUD">−</button>
    `;

    document.body.appendChild(root);

    const button = root.querySelector(".ocean-performance-hud__button") as HTMLButtonElement;

    button.addEventListener("click", () => {
        root.classList.toggle("is-compact");
        button.textContent = root.classList.contains("is-compact") ? "+" : "−";
    });

    return {
        root,
        fps: root.querySelector('[data-hud="fps"]') as HTMLElement,
        frame: root.querySelector('[data-hud="frame"]') as HTMLElement,
        draws: root.querySelector('[data-hud="draws"]') as HTMLElement,
        tris: root.querySelector('[data-hud="tris"]') as HTMLElement,
        dpr: root.querySelector('[data-hud="dpr"]') as HTMLElement,
        orbitMode: root.querySelector('[data-camera-mode="orbit"]') as HTMLElement,
        flyMode: root.querySelector('[data-camera-mode="fly"]') as HTMLElement,
        boatMode: root.querySelector('[data-camera-mode="boat"]') as HTMLElement,
        moveRow: root.querySelector('[data-hud="move-row"]') as HTMLElement,
        verticalRow: root.querySelector('[data-hud="vertical-row"]') as HTMLElement,
        underwaterState: root.querySelector('[data-hud="underwater-state"]') as HTMLElement,
        underwaterDepth: root.querySelector('[data-hud="underwater-depth"]') as HTMLElement,
        underwaterAmount: root.querySelector('[data-hud="underwater-amount"]') as HTMLElement
    };
}

function updateCameraModeHud(hud: PerformanceHudElements, mode: CameraMode) {
    const modeElements: Record<CameraMode, HTMLElement> = {
        orbit: hud.orbitMode,
        fly: hud.flyMode,
        boat: hud.boatMode
    };

    (Object.keys(modeElements) as CameraMode[]).forEach((cameraMode) => {
        const row = modeElements[cameraMode];
        const label = row.querySelector(`[data-camera-label="${cameraMode}"]`) as HTMLElement;
        const number = row.querySelector(`[data-camera-number="${cameraMode}"]`) as HTMLElement;

        const isActive = cameraMode === mode;

        label.className = isActive ? "ocean-performance-hud__active" : "ocean-performance-hud__inactive";
        number.className = isActive ? "ocean-performance-hud__active" : "ocean-performance-hud__inactive";
    });

    hud.moveRow.style.display = mode === "orbit" ? "none" : "flex";
    hud.verticalRow.style.display = mode === "fly" ? "flex" : "none";
}

function formatLargeNumber(value: number) {
    if (value >= 1_000_000) {
        return `${(value / 1_000_000).toFixed(1)}M`;
    }

    if (value >= 1_000) {
        return `${(value / 1_000).toFixed(1)}K`;
    }

    return `${Math.round(value)}`;
}

function getActiveMeshCollection(scene: Scene): ActiveMeshCollection {
    return scene.getActiveMeshes() as unknown as ActiveMeshCollection;
}

function getActiveMeshAt(activeMeshes: ActiveMeshCollection, index: number): AbstractMesh | undefined {
    return activeMeshes.data[index];
}

function getActiveMeshCount(scene: Scene) {
    return getActiveMeshCollection(scene).length;
}

function getActiveTriangleCount(scene: Scene) {
    const activeMeshes = getActiveMeshCollection(scene);

    let triangles = 0;

    for (let i = 0; i < activeMeshes.length; i++) {
        const mesh = getActiveMeshAt(activeMeshes, i);

        if (!mesh || typeof mesh.getTotalIndices !== "function") continue;

        triangles += mesh.getTotalIndices() / 3;
    }

    return triangles;
}

function registerTintedSkyboxShader() {
    Effect.ShadersStore["tintedSkyboxVertexShader"] = `
        precision highp float;

        attribute vec3 position;

        uniform mat4 worldViewProjection;

        varying vec3 vDirection;

        void main() {
            vDirection = position;
            gl_Position = worldViewProjection * vec4(position, 1.0);
        }
    `;

    Effect.ShadersStore["tintedSkyboxFragmentShader"] = `
        precision highp float;

        varying vec3 vDirection;

        uniform samplerCube skyboxSampler;
        uniform vec3 sunDirection;
        uniform float underwaterAmount;
        uniform float cameraDepthBelowSurface;

        float saturate(float value) {
            return clamp(value, 0.0, 1.0);
        }

        vec3 saturateVec3(vec3 value) {
            return clamp(value, vec3(0.0), vec3(1.0));
        }

        vec3 softTonemap(vec3 color) {
            return color / (color + vec3(1.0));
        }

        void main() {
            vec3 dir = normalize(vDirection);
            vec3 sunDir = normalize(sunDirection);

            vec3 color = textureCube(skyboxSampler, dir).rgb;

            float horizonBand = 1.0 - smoothstep(0.02, 0.22, abs(dir.y));
            float lowerSkyBias = 1.0 - smoothstep(0.0, 0.30, dir.y);
            float tintAmount = horizonBand * lowerSkyBias * 0.90;

            vec3 skyBlue = vec3(0.34, 0.66, 0.96);
            color = mix(color, skyBlue, tintAmount);

            float upperBlend = 1.0 - smoothstep(0.18, 0.42, dir.y);
            color = mix(color, vec3(0.50, 0.72, 0.92), upperBlend * 0.12);

            float sunAlignment = saturate(dot(dir, sunDir));

            float sunCore = smoothstep(0.99978, 0.99996, sunAlignment);
            float sunInnerGlow = pow(sunAlignment, 720.0) * 0.55;
            float sunHalo = pow(sunAlignment, 85.0) * 0.36;
            float wideAtmosphereGlow = pow(sunAlignment, 18.0) * 0.22;

            vec3 sunCoreColor = vec3(1.0, 0.87, 0.58);
            vec3 sunHaloColor = vec3(1.0, 0.67, 0.42);
            vec3 skyGlowColor = vec3(0.72, 0.88, 1.0);

            color += sunCoreColor * sunCore * 3.5;
            color += sunCoreColor * sunInnerGlow;
            color += sunHaloColor * sunHalo;
            color += skyGlowColor * wideAtmosphereGlow;

            float depthBlend = smoothstep(0.0, 22.0, cameraDepthBelowSurface);

            vec3 shallowWaterBackground = vec3(0.020, 0.160, 0.160);
            vec3 midWaterBackground = vec3(0.006, 0.085, 0.105);
            vec3 deepWaterBackground = vec3(0.0015, 0.025, 0.042);

            vec3 waterBackground = mix(shallowWaterBackground, midWaterBackground, depthBlend);
            waterBackground = mix(waterBackground, deepWaterBackground, depthBlend * depthBlend);

            float underwaterBlend = underwaterAmount * (0.78 + depthBlend * 0.18);

            color = mix(color, waterBackground, underwaterBlend);

            float underwaterSun = pow(sunAlignment, 24.0) * underwaterAmount * (1.0 - depthBlend * 0.55);
            color += vec3(0.55, 0.90, 1.0) * underwaterSun * 0.22;

            color = softTonemap(color * 1.08) * 1.22;

            gl_FragColor = vec4(saturateVec3(color), 1.0);
        }
    `;
}

function createDebugBoat(scene: Scene) {
    const boatRoot = new TransformNode("debugBoatRoot", scene);

    const hullMaterial = new StandardMaterial("debugBoatHullMaterial", scene);
    hullMaterial.diffuseColor = new Color3(0.055, 0.075, 0.09);
    hullMaterial.specularColor = new Color3(0.12, 0.16, 0.18);

    const cabinMaterial = new StandardMaterial("debugBoatCabinMaterial", scene);
    cabinMaterial.diffuseColor = new Color3(0.86, 0.9, 0.92);
    cabinMaterial.specularColor = new Color3(0.18, 0.2, 0.22);

    const railMaterial = new StandardMaterial("debugBoatRailMaterial", scene);
    railMaterial.diffuseColor = new Color3(0.68, 0.76, 0.8);
    railMaterial.specularColor = new Color3(0.22, 0.26, 0.28);

    const hull = MeshBuilder.CreateBox(
        "debugBoatHull",
        {
            width: 1.15,
            height: 0.28,
            depth: 2.85
        },
        scene
    );

    hull.parent = boatRoot;
    hull.position.y = 0.13;
    hull.material = hullMaterial;

    const bow = MeshBuilder.CreateBox(
        "debugBoatBow",
        {
            width: 0.82,
            height: 0.22,
            depth: 0.72
        },
        scene
    );

    bow.parent = boatRoot;
    bow.position.y = 0.17;
    bow.position.z = 1.58;
    bow.rotation.y = Math.PI / 4;
    bow.material = hullMaterial;

    const cabin = MeshBuilder.CreateBox(
        "debugBoatCabin",
        {
            width: 0.68,
            height: 0.42,
            depth: 0.72
        },
        scene
    );

    cabin.parent = boatRoot;
    cabin.position.y = 0.48;
    cabin.position.z = -0.28;
    cabin.material = cabinMaterial;

    const mast = MeshBuilder.CreateCylinder(
        "debugBoatMast",
        {
            height: 1.25,
            diameter: 0.045,
            tessellation: 10
        },
        scene
    );

    mast.parent = boatRoot;
    mast.position.y = 0.95;
    mast.position.z = 0.42;
    mast.material = railMaterial;

    const frontRail = MeshBuilder.CreateBox(
        "debugBoatFrontRail",
        {
            width: 0.9,
            height: 0.045,
            depth: 0.045
        },
        scene
    );

    frontRail.parent = boatRoot;
    frontRail.position.y = 0.39;
    frontRail.position.z = 1.02;
    frontRail.material = railMaterial;

    const rearRail = MeshBuilder.CreateBox(
        "debugBoatRearRail",
        {
            width: 0.9,
            height: 0.045,
            depth: 0.045
        },
        scene
    );

    rearRail.parent = boatRoot;
    rearRail.position.y = 0.39;
    rearRail.position.z = -1.02;
    rearRail.material = railMaterial;

    boatRoot.scaling.setAll(1.0);
    boatRoot.setEnabled(false);

    return boatRoot;
}

function configureTiledTexture(texture: Texture, scale: number) {
    texture.wrapU = Texture.WRAP_ADDRESSMODE;
    texture.wrapV = Texture.WRAP_ADDRESSMODE;
    texture.uScale = scale;
    texture.vScale = scale;
}

function createSeabedMaterial(scene: Scene) {
    const material = new PBRMaterial("seabedPBRMaterial", scene);

    const colorTexture = new Texture(
        "/textures/underwater/seabed/sand_01/sand_01_color.png",
        scene
    );

    const aoTexture = new Texture(
        "/textures/underwater/seabed/sand_01/sand_01_ao.png",
        scene
    );

    const normalTexture = new Texture(
        "/textures/underwater/seabed/sand_01/sand_01_normal_gl.png",
        scene
    );

    const roughnessTexture = new Texture(
        "/textures/underwater/seabed/sand_01/sand_01_roughness.png",
        scene
    );

    configureTiledTexture(colorTexture, 70);
    configureTiledTexture(aoTexture, 70);
    configureTiledTexture(normalTexture, 70);
    configureTiledTexture(roughnessTexture, 70);

    aoTexture.gammaSpace = false;
    normalTexture.gammaSpace = false;
    roughnessTexture.gammaSpace = false;

    material.albedoTexture = colorTexture;
    material.ambientTexture = aoTexture;
    material.bumpTexture = normalTexture;
    material.metallicTexture = roughnessTexture;

    material.albedoColor = new Color3(0.72, 0.68, 0.56);
    material.metallic = 0;
    material.roughness = 0.94;
    material.environmentIntensity = 0.22;
    material.directIntensity = 0.72;
    material.specularIntensity = 0.12;

    return material;
}

const canvas = document.getElementById("renderer") as HTMLCanvasElement;
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
});

if (!(await WebGPUEngine.IsSupportedAsync)) {
    alert(
        "WebGPU is not supported in your browser. Please check the compatibility here: https://github.com/gpuweb/gpuweb/wiki/Implementation-Status#implementation-status"
    );
}

const performanceHud = createPerformanceHud();

const engine = new WebGPUEngine(canvas, { antialias: true });
engine.loadingScreen.displayLoadingUI();
await engine.initAsync();

const scene = new Scene(engine);

scene.ambientColor = new Color3(0.18, 0.22, 0.22);

const camera = new ArcRotateCamera(
    "camera",
    Math.PI / 3,
    Math.PI / 2.08,
    18,
    new Vector3(0, 0.35, 0),
    scene
);

camera.minZ = 0.05;
camera.maxZ = 3000;
camera.wheelPrecision = 80;
camera.angularSensibilityX = 3000;
camera.angularSensibilityY = 3000;
camera.lowerRadiusLimit = 5;
camera.upperRadiusLimit = 90;
camera.lowerBetaLimit = Math.PI / 3.1;
camera.upperBetaLimit = Math.PI / 1.92;
camera.panningSensibility = 65;
camera.panningDistanceLimit = 0;
camera.panningAxis = new Vector3(1, 0, 1);
camera.attachControl(canvas, true);

const light = new DirectionalLight("light", new Vector3(0.85, -1.0, 2.2).normalize(), scene);
light.intensity = 2.25;
light.diffuse = new Color3(1.0, 0.96, 0.86);
light.specular = new Color3(1.0, 0.92, 0.76);

const surfaceAmbientLight = new HemisphericLight(
    "surfaceAmbientLight",
    new Vector3(0.0, 1.0, 0.0),
    scene
);

surfaceAmbientLight.intensity = 0.24;
surfaceAmbientLight.diffuse = new Color3(0.55, 0.70, 0.78);
surfaceAmbientLight.groundColor = new Color3(0.10, 0.13, 0.11);
surfaceAmbientLight.specular = new Color3(0.04, 0.05, 0.05);

const textureSize = 256;
const tileSize = 10;

const initialSpectrum = new PhillipsSpectrum(textureSize, tileSize, engine);
const waterMaterial = new WaterMaterial("waterMaterial", initialSpectrum, scene, engine);

registerTintedSkyboxShader();

const skybox = MeshBuilder.CreateBox("skyBox", { size: camera.maxZ / 2 }, scene);
skybox.infiniteDistance = true;

const skyboxMaterial = new ShaderMaterial(
    "tintedSkyboxMaterial",
    scene,
    "tintedSkybox",
    {
        attributes: ["position"],
        uniforms: [
            "worldViewProjection",
            "sunDirection",
            "underwaterAmount",
            "cameraDepthBelowSurface"
        ],
        samplers: ["skyboxSampler"]
    }
);

skyboxMaterial.backFaceCulling = false;
skyboxMaterial.disableDepthWrite = true;
skyboxMaterial.setTexture("skyboxSampler", waterMaterial.reflectionTexture);
skyboxMaterial.setVector3("sunDirection", light.direction.scale(-1).normalize());
skyboxMaterial.setFloat("underwaterAmount", 0);
skyboxMaterial.setFloat("cameraDepthBelowSurface", 0);

skybox.material = skyboxMaterial;

const oceanSize = 900;

const ground = MeshBuilder.CreateGround(
    "ground",
    {
        width: oceanSize * 1.5,
        height: oceanSize * 1.5,
        subdivisions: 24
    },
    scene
);

ground.material = createSeabedMaterial(scene);
ground.position.y = -10;

const water = MeshBuilder.CreateGround(
    "water",
    {
        width: oceanSize,
        height: oceanSize,
        subdivisions: 768
    },
    scene
);

water.material = waterMaterial;

const underwaterSystem = new UnderwaterSystem({
    scene,
    camera,
    getWaterLevel: () => water.position.y,
    transitionDepth: 0.35
});

underwaterSystem.registerWaterMesh(water);
underwaterSystem.registerWaterMaterial(waterMaterial);
underwaterSystem.update();

const debugBoat = createDebugBoat(scene);

Effect.ShadersStore["PostProcess1FragmentShader"] = postProcessCode;

const postProcess = new PostProcess(
    "postProcess1",
    "PostProcess1",
    [
        "cameraInverseView",
        "cameraInverseProjection",
        "cameraPosition",
        "time",
        "waterLevel",
        "underwaterAmount",
        "cameraDepthBelowSurface"
    ],
    ["textureSampler", "depthSampler"],
    1,
    camera,
    Texture.BILINEAR_SAMPLINGMODE,
    engine
);

postProcess.onApplyObservable.add((effect) => {
    underwaterSystem.applyToPostProcessEffect(effect);
    effect.setFloat("time", performance.now() * 0.001);
});

let activeCameraMode: CameraMode = "orbit";
let performanceHudTimer = 0;
let boatTime = 0;

const keyState: Record<string, boolean> = {};

function setCameraMode(mode: CameraMode) {
    activeCameraMode = mode;

    debugBoat.setEnabled(mode === "boat");

    if (mode === "orbit") {
        camera.lowerRadiusLimit = 5;
        camera.upperRadiusLimit = 90;
        camera.lowerBetaLimit = Math.PI / 3.1;
        camera.upperBetaLimit = Math.PI / 1.92;
        camera.radius = 18;
        camera.beta = Math.PI / 2.08;
        camera.target.y = 0.35;
        camera.panningSensibility = 65;
    }

    if (mode === "fly") {
        camera.lowerRadiusLimit = 3;
        camera.upperRadiusLimit = 140;
        camera.lowerBetaLimit = Math.PI / 3.5;
        camera.upperBetaLimit = Math.PI / 1.86;
        camera.radius = 14;
        camera.beta = Math.PI / 2.04;
        camera.panningSensibility = 55;
    }

    if (mode === "boat") {
        camera.lowerRadiusLimit = 4;
        camera.upperRadiusLimit = 55;
        camera.lowerBetaLimit = Math.PI / 2.45;
        camera.upperBetaLimit = Math.PI / 1.88;
        camera.radius = 8.5;
        camera.beta = Math.PI / 1.98;
        camera.target.y = 0.18;
        camera.panningSensibility = 75;
    }

    updateCameraModeHud(performanceHud, mode);
}

function getFlatForwardDirection() {
    const forward = camera.target.subtract(camera.position);
    forward.y = 0;

    if (forward.lengthSquared() < 0.0001) {
        return new Vector3(0, 0, 1);
    }

    return forward.normalize();
}

function getFlatRightDirection(forward: Vector3) {
    const right = Vector3.Cross(Vector3.Up(), forward);
    right.y = 0;

    if (right.lengthSquared() < 0.0001) {
        return new Vector3(1, 0, 0);
    }

    return right.normalize();
}

function updateCameraMovement(deltaSeconds: number) {
    if (activeCameraMode === "orbit") return;

    const forward = getFlatForwardDirection();
    const right = getFlatRightDirection(forward);

    const movement = Vector3.Zero();

    if (keyState["w"] || keyState["arrowup"]) movement.addInPlace(forward);
    if (keyState["s"] || keyState["arrowdown"]) movement.subtractInPlace(forward);
    if (keyState["d"] || keyState["arrowright"]) movement.addInPlace(right);
    if (keyState["a"] || keyState["arrowleft"]) movement.subtractInPlace(right);

    if (movement.lengthSquared() > 0.0001) {
        const speed = activeCameraMode === "boat" ? 6.5 : 13.0;
        movement.normalize().scaleInPlace(speed * deltaSeconds);
        camera.target.addInPlace(movement);
    }

    if (activeCameraMode === "fly") {
        const verticalSpeed = 6.0 * deltaSeconds;

        if (keyState["e"]) camera.target.y += verticalSpeed;
        if (keyState["q"]) camera.target.y -= verticalSpeed;

        camera.target.y = Math.max(-8.0, Math.min(camera.target.y, 24.0));
    }

    if (activeCameraMode === "boat") {
        boatTime += deltaSeconds;

        const boatBaseHeight = 0.18;
        const boatBob = Math.sin(boatTime * 1.7) * 0.035 + Math.sin(boatTime * 3.9) * 0.014;

        camera.target.y = boatBaseHeight + boatBob;
    }
}

function updateDebugBoat() {
    if (activeCameraMode !== "boat") return;

    debugBoat.position.x = camera.target.x;
    debugBoat.position.y = camera.target.y - 0.08;
    debugBoat.position.z = camera.target.z;

    const forward = getFlatForwardDirection();
    debugBoat.rotation.y = Math.atan2(forward.x, forward.z);
}

function updatePerformanceHud(deltaSeconds: number) {
    performanceHudTimer += deltaSeconds;

    if (performanceHudTimer < 0.18) return;

    performanceHudTimer = 0;

    const underwaterState = underwaterSystem.getState();

    performanceHud.fps.textContent = `${Math.round(engine.getFps())}`;
    performanceHud.frame.textContent = `${Math.round(engine.getDeltaTime())} ms`;
    performanceHud.draws.textContent = `${getActiveMeshCount(scene)}`;
    performanceHud.tris.textContent = formatLargeNumber(getActiveTriangleCount(scene));
    performanceHud.dpr.textContent = window.devicePixelRatio.toFixed(2);

    performanceHud.underwaterState.textContent = underwaterState.isUnderwater ? "YES" : "NO";
    performanceHud.underwaterDepth.textContent = underwaterState.cameraDepthBelowSurface.toFixed(2);
    performanceHud.underwaterAmount.textContent = underwaterState.underwaterAmount.toFixed(2);
}

function updateScene() {
    const deltaSeconds = engine.getDeltaTime() / 1000;

    updateCameraMovement(deltaSeconds);
    updateDebugBoat();

    underwaterSystem.update();

    const underwaterState = underwaterSystem.getState();

    skyboxMaterial.setVector3("sunDirection", light.direction.scale(-1).normalize());
    skyboxMaterial.setFloat("underwaterAmount", underwaterState.underwaterAmount);
    skyboxMaterial.setFloat("cameraDepthBelowSurface", underwaterState.cameraDepthBelowSurface);

    waterMaterial.update(deltaSeconds, light.direction);
    updatePerformanceHud(deltaSeconds);
}

window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();

    keyState[key] = true;

    if (key === "1") setCameraMode("orbit");
    if (key === "2") setCameraMode("fly");
    if (key === "3") setCameraMode("boat");
});

window.addEventListener("keyup", (event) => {
    keyState[event.key.toLowerCase()] = false;
});

performanceHud.orbitMode.addEventListener("click", () => setCameraMode("orbit"));
performanceHud.flyMode.addEventListener("click", () => setCameraMode("fly"));
performanceHud.boatMode.addEventListener("click", () => setCameraMode("boat"));

setCameraMode("orbit");

scene.executeWhenReady(() => {
    engine.loadingScreen.hideLoadingUI();

    scene.registerBeforeRender(() => updateScene());

    engine.runRenderLoop(() => {
        scene.render();
    });
});

window.addEventListener("resize", () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    engine.resize(true);

    underwaterSystem.resize();
    waterMaterial.resizeSupportTextures(engine.getRenderWidth(), engine.getRenderHeight());
});