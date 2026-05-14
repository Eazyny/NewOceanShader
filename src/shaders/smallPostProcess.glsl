precision highp float;

varying vec2 vUV;

uniform sampler2D textureSampler;
uniform sampler2D depthSampler;

uniform mat4 cameraInverseProjection;
uniform mat4 cameraInverseView;
uniform vec3 cameraPosition;

uniform float time;
uniform float waterLevel;
uniform float underwaterAmount;
uniform float cameraDepthBelowSurface;

float saturate(float value) {
    return clamp(value, 0.0, 1.0);
}

vec3 saturateVec3(vec3 value) {
    return clamp(value, vec3(0.0), vec3(1.0));
}

vec3 grayscale(vec3 color) {
    return vec3(dot(color, vec3(0.299, 0.587, 0.114)));
}

vec3 reconstructWorldPosition(vec2 uv, float depth) {
    vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 view = cameraInverseProjection * clip;
    view /= view.w;
    vec4 world = cameraInverseView * view;

    return world.xyz / world.w;
}

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);

    return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);

    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));

    vec2 u = f * f * (3.0 - 2.0 * f);

    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;

    v += valueNoise(p) * a;
    p *= 2.02;
    a *= 0.5;

    v += valueNoise(p) * a;
    p *= 2.09;
    a *= 0.5;

    v += valueNoise(p) * a;

    return v;
}

float getAboveWaterFogFactor(float depth, vec3 rayDir) {
    const float LOG2 = 1.442695;
    const float density = 380.0;
    const float start = 0.35;
    const float end = 1.0;

    float fogFactor = exp2(-density * density * depth * depth * LOG2);
    fogFactor = 1.0 - clamp((fogFactor - start) / (end - start), 0.0, 1.0);
    fogFactor *= pow(1.0 - abs(rayDir.y), 4.0);

    return fogFactor;
}

vec3 getUnderwaterBackground(vec2 uv, float depthFactor) {
    vec3 shallow = vec3(0.018, 0.145, 0.145);
    vec3 mid = vec3(0.006, 0.085, 0.105);
    vec3 deep = vec3(0.0015, 0.025, 0.042);

    vec3 color = mix(shallow, mid, depthFactor);
    color = mix(color, deep, depthFactor * depthFactor);

    float verticalGlow = smoothstep(0.10, 0.95, uv.y);
    color += vec3(0.020, 0.070, 0.075) * verticalGlow * (1.0 - depthFactor * 0.65);

    return color;
}

void main() {
    float rawDepth = texture2D(depthSampler, vUV).r;
    vec3 baseColor = texture2D(textureSampler, vUV).rgb;

    vec3 worldPos = reconstructWorldPosition(vUV, rawDepth);
    vec3 rayDir = normalize(worldPos - cameraPosition);

    if (underwaterAmount < 0.001) {
        float fogFactor = getAboveWaterFogFactor(rawDepth, rayDir);
        vec3 fogColor = vec3(0.80);

        vec3 color = baseColor;

        const float exposure = 1.0;
        const float contrast = 1.0;
        const float brightness = 0.0;
        const float saturation = 1.15;

        color *= exposure;
        color = clamp(color, 0.0, 1.0);

        color = (color - 0.5) * contrast + 0.5 + brightness;
        color = clamp(color, 0.0, 1.0);

        color = mix(grayscale(color), color, saturation);
        color = clamp(color, 0.0, 1.0);

        color = mix(color, fogColor, fogFactor);

        gl_FragColor = vec4(color, 1.0);
        return;
    }

    float cameraDepthFactor = smoothstep(0.0, 20.0, cameraDepthBelowSurface);

    /*
        Critical fix:
        Empty far-background pixels should become underwater volume,
        not black infinite-depth absorption.
    */
    if (rawDepth >= 0.999) {
        vec3 background = getUnderwaterBackground(vUV, cameraDepthFactor);
        gl_FragColor = vec4(background, 1.0);
        return;
    }

    float viewDistance = length(worldPos - cameraPosition);
    float sceneDepthBelowSurface = max(waterLevel - worldPos.y, 0.0);

    vec3 absorption = vec3(0.050, 0.026, 0.014);
    vec3 transmittance = exp(-absorption * viewDistance * 0.30);

    vec3 color = baseColor * transmittance;

    vec3 shallowScatter = vec3(0.018, 0.130, 0.132);
    vec3 deepScatter = vec3(0.002, 0.050, 0.070);
    vec3 scatterColor = mix(shallowScatter, deepScatter, cameraDepthFactor);

    float scatterAmount = 1.0 - exp(-viewDistance * 0.038);
    color = mix(color, scatterColor, scatterAmount * 0.25);

    /*
        World-space underwater caustics.
        This is not final ray-caustics, but it is depth-aware and projected onto real geometry.
    */
    if (sceneDepthBelowSurface > 0.01) {
        vec2 cuv1 = worldPos.xz * 0.72 + vec2(time * 0.22, time * 0.15);
        vec2 cuv2 = worldPos.xz * 1.32 + vec2(-time * 0.18, time * 0.26);
        vec2 cuv3 = worldPos.xz * 2.10 + vec2(time * 0.09, -time * 0.14);

        float c1 = fbm(cuv1);
        float c2 = fbm(cuv2);
        float c3 = fbm(cuv3);

        float causticPattern = c1 * 0.50 + c2 * 0.32 + c3 * 0.18;
        causticPattern = smoothstep(0.56, 0.84, causticPattern);

        float causticFadeByDepth = exp(-sceneDepthBelowSurface * 0.40);
        float causticFadeByDistance = exp(-viewDistance * 0.016);

        float caustics = causticPattern * causticFadeByDepth * causticFadeByDistance;

        vec3 causticColor = vec3(0.22, 0.34, 0.24);
        color += causticColor * caustics * 0.62;
    }

    float luminance = dot(baseColor, vec3(0.299, 0.587, 0.114));
    float highlightPreserve = smoothstep(0.45, 0.92, luminance);
    color = mix(color, baseColor, highlightPreserve * 0.18);

    float desat = 0.03 + cameraDepthFactor * 0.04;
    color = mix(color, grayscale(color), desat);

    vec2 centered = vUV * 2.0 - 1.0;
    float vignette = 1.0 - dot(centered, centered) * 0.025;
    color *= clamp(vignette, 0.95, 1.0);

    gl_FragColor = vec4(saturateVec3(color), 1.0);
}