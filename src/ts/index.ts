import "../styles/index.css";

import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import "@babylonjs/core/Loading/loadingScreen";
import { WebGPUEngine } from "@babylonjs/core/Engines";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";

import { WaterMaterial } from "./waterMaterial";
import { PhillipsSpectrum } from "./spectrum/phillipsSpectrum";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { PostProcess } from "@babylonjs/core/PostProcesses/postProcess";
import { Effect } from "@babylonjs/core/Materials/effect";

import "@babylonjs/core/Rendering/depthRendererSceneComponent";

import sandTexture from "../assets/sand.jpg";

import postProcessCode from "../shaders/smallPostProcess.glsl";
// import { OceanPlanetMaterial } from "./planet/oceanPlanetMaterial";
// import { Planet } from "./planet/planet";

type PerformanceHudElements = {
    root: HTMLDivElement;
    fps: HTMLElement;
    frame: HTMLElement;
    draws: HTMLElement;
    tris: HTMLElement;
    dpr: HTMLElement;
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

            <div class="ocean-performance-hud__row">
                <span class="ocean-performance-hud__active">Orbit</span>
                <span class="ocean-performance-hud__inactive">1</span>
            </div>

            <div class="ocean-performance-hud__row">
                <span class="ocean-performance-hud__inactive">Fly</span>
                <span class="ocean-performance-hud__inactive">2</span>
            </div>

            <div class="ocean-performance-hud__row">
                <span class="ocean-performance-hud__inactive">Boat</span>
                <span class="ocean-performance-hud__inactive">3</span>
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
        dpr: root.querySelector('[data-hud="dpr"]') as HTMLElement
    };
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

function getActiveMeshCount(scene: Scene) {
    const activeMeshes = scene.getActiveMeshes() as any;
    return typeof activeMeshes.length === "number" ? activeMeshes.length : 0;
}

function getActiveTriangleCount(scene: Scene) {
    const activeMeshes = scene.getActiveMeshes() as any;
    const length = typeof activeMeshes.length === "number" ? activeMeshes.length : 0;

    let triangles = 0;

    for (let i = 0; i < length; i++) {
        const mesh = activeMeshes.data?.[i] ?? activeMeshes[i];

        if (!mesh || typeof mesh.getTotalIndices !== "function") continue;

        triangles += mesh.getTotalIndices() / 3;
    }

    return triangles;
}

const canvas = document.getElementById("renderer") as HTMLCanvasElement;
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

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
camera.attachControl();

const light = new DirectionalLight("light", new Vector3(0.85, -1.0, 2.2).normalize(), scene);

const textureSize = 256;
const tileSize = 10;

const depthRenderer = scene.enableDepthRenderer(camera, false, true);
const initialSpectrum = new PhillipsSpectrum(textureSize, tileSize, engine);
const waterMaterial = new WaterMaterial("waterMaterial", initialSpectrum, scene, engine);

/*
const oceanPlanetMaterial = new OceanPlanetMaterial("oceanPlanet", initialSpectrum, scene);
const planetRadius = 2;
const planet = new Planet(planetRadius, oceanPlanetMaterial, scene);
planet.transform.position.y = planetRadius + 1;
planet.transform.position.x = -10;
planet.transform.position.z = -5;
*/

const skybox = MeshBuilder.CreateBox("skyBox", { size: camera.maxZ / 2 }, scene);
skybox.infiniteDistance = true;

const skyboxMaterial = new StandardMaterial("skyBox", scene);
skyboxMaterial.backFaceCulling = false;
skyboxMaterial.reflectionTexture = waterMaterial.reflectionTexture;
skyboxMaterial.reflectionTexture.coordinatesMode = Texture.SKYBOX_MODE;
skyboxMaterial.disableLighting = true;
skybox.material = skyboxMaterial;

const groundMaterial = new StandardMaterial("groundMaterial", scene);
groundMaterial.diffuseTexture = new Texture(sandTexture, scene);
groundMaterial.specularColor.scaleInPlace(0);

const oceanSize = 260;

const ground = MeshBuilder.CreateGround(
    "ground",
    {
        width: oceanSize * 1.5,
        height: oceanSize * 1.5,
        subdivisions: 4
    },
    scene
);

ground.material = groundMaterial;
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

Effect.ShadersStore["PostProcess1FragmentShader"] = postProcessCode;

const postProcess = new PostProcess(
    "postProcess1",
    "PostProcess1",
    ["cameraInverseView", "cameraInverseProjection", "cameraPosition"],
    ["textureSampler", "depthSampler"],
    1,
    camera,
    Texture.BILINEAR_SAMPLINGMODE,
    engine
);

postProcess.onApplyObservable.add((effect) => {
    effect.setTexture("depthSampler", depthRenderer.getDepthMap());
    effect.setMatrix("cameraInverseView", camera.getViewMatrix().clone().invert());
    effect.setMatrix("cameraInverseProjection", camera.getProjectionMatrix().clone().invert());
});

let performanceHudTimer = 0;

function updatePerformanceHud(deltaSeconds: number) {
    performanceHudTimer += deltaSeconds;

    if (performanceHudTimer < 0.18) return;

    performanceHudTimer = 0;

    performanceHud.fps.textContent = `${Math.round(engine.getFps())}`;
    performanceHud.frame.textContent = `${Math.round(engine.getDeltaTime())} ms`;
    performanceHud.draws.textContent = `${getActiveMeshCount(scene)}`;
    performanceHud.tris.textContent = formatLargeNumber(getActiveTriangleCount(scene));
    performanceHud.dpr.textContent = window.devicePixelRatio.toFixed(2);
}

function updateScene() {
    const deltaSeconds = engine.getDeltaTime() / 1000;

    waterMaterial.update(deltaSeconds, light.direction);
    updatePerformanceHud(deltaSeconds);

    // oceanPlanetMaterial.update(deltaSeconds, planet.transform, light.direction);
}

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
});