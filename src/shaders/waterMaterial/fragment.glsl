precision highp float;

varying vec3 vNormalW;
varying vec3 vPositionW;
varying vec4 vPositionClip;

uniform vec3 cameraPositionW;
uniform vec3 lightDirection;

uniform mat4 cameraInverseProjection;
uniform mat4 cameraInverseView;

uniform float time;
uniform float waterLevel;
uniform float cameraDepthBelowSurface;
uniform float isUnderwater;
uniform float underwaterAmount;

uniform sampler2D depthSampler;
uniform sampler2D textureSampler;
uniform samplerCube reflectionSampler;

const float WATER_F0 = 0.020;
const float WATER_TO_AIR_ETA = 1.333;

float saturate(float value) {
    return clamp(value, 0.0, 1.0);
}

vec3 saturateVec3(vec3 value) {
    return clamp(value, vec3(0.0), vec3(1.0));
}

vec3 softTonemap(vec3 color) {
    return color / (color + vec3(1.0));
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
    float value = 0.0;
    float amplitude = 0.5;

    value += valueNoise(p) * amplitude;
    p *= 2.03;
    amplitude *= 0.5;

    value += valueNoise(p) * amplitude;
    p *= 2.11;
    amplitude *= 0.5;

    value += valueNoise(p) * amplitude;

    return value;
}

float schlickFresnel(float cosTheta, float f0) {
    float oneMinusCos = 1.0 - saturate(cosTheta);

    return f0 + (1.0 - f0) * pow(oneMinusCos, 5.0);
}

vec2 getScreenUV() {
    vec2 screenUV = vPositionClip.xy / max(vPositionClip.w, 0.0001);
    screenUV = screenUV * 0.5 + 0.5;

    return screenUV;
}

float estimateDepthSeparation(float surfaceClipZ, float rawDepth) {
    float surfaceDepth01 = saturate(surfaceClipZ / max(vPositionClip.w, 0.0001));

    float forwardDelta = rawDepth - surfaceDepth01;
    float reverseDelta = surfaceDepth01 - rawDepth;

    float depthDelta = max(forwardDelta, reverseDelta);

    return max(depthDelta, 0.0);
}

float estimateWaterThickness(float depthDelta, float viewDotUp, float cameraDistance) {
    /*
        Tuning update:
        The previous version made water too opaque because raw depth-buffer
        differences were scaled too aggressively. This version keeps the same
        structure but uses a gentler scene-scale conversion.
    */
    float anglePathBoost = 1.0 / max(abs(viewDotUp), 0.34);
    float nearScale = mix(16.0, 62.0, saturate(cameraDistance / 260.0));

    float thickness = depthDelta * nearScale * anglePathBoost;

    return clamp(thickness, 0.0, 34.0);
}

bool isLikelyBackgroundDepth(float rawDepth) {
    return rawDepth <= 0.00001 || rawDepth >= 0.99999;
}

vec3 sampleEnvironment(vec3 direction) {
    vec3 color = textureCube(reflectionSampler, normalize(direction)).rgb;

    color = softTonemap(color * 1.55) * 1.24;

    return color;
}

vec3 beerLambert(vec3 color, float thickness) {
    /*
        Tuning update:
        Gentler clear/tropical water absorption. Red still attenuates first,
        then green, then blue, but shallow water remains readable.
    */
    vec3 absorption = vec3(0.065, 0.026, 0.010);
    vec3 transmittance = exp(-absorption * thickness);

    return color * transmittance;
}

vec3 waterVolumeColor(float thickness, float depthBias) {
    /*
        Tuning update:
        Less black, more luminous blue/cyan volume color. This is still not a
        fake tint; it is the fallback/scattering color when transmitted scene
        detail is attenuated.
    */
    vec3 shallow = vec3(0.050, 0.300, 0.350);
    vec3 mid = vec3(0.018, 0.145, 0.215);
    vec3 deep = vec3(0.006, 0.060, 0.115);

    float depth01 = saturate(thickness / 38.0 + depthBias);

    vec3 color = mix(shallow, mid, smoothstep(0.0, 0.72, depth01));
    color = mix(color, deep, smoothstep(0.54, 1.0, depth01));

    return color;
}

vec3 applySurfaceSunGlint(
    vec3 baseColor,
    vec3 normal,
    vec3 viewRayW,
    vec3 viewToCameraW,
    vec3 sunDirectionW,
    float viewDotNormal,
    float ndl
) {
    vec3 reflectedRayW = reflect(viewRayW, normal);
    float sunReflectionAlignment = saturate(dot(reflectedRayW, sunDirectionW));

    float glintBroad = pow(sunReflectionAlignment, 18.0) * 0.22;
    float glintMid = pow(sunReflectionAlignment, 48.0) * 0.42;
    float glintTight = pow(sunReflectionAlignment, 150.0) * 0.84;

    vec2 animatedP = vPositionW.xz + vec2(time * 0.08, -time * 0.045);

    float glintNoiseLarge = fbm(animatedP * 0.55 + normal.xz * 7.0);
    float glintNoiseFine = fbm(animatedP * 2.15 + normal.xz * 18.0 + vec2(12.7, 4.1));

    float glintBreakup = glintNoiseLarge * 0.58 + glintNoiseFine * 0.42;
    glintBreakup = smoothstep(0.34, 0.88, glintBreakup);

    float glancingBoost = 0.20 + pow(1.0 - viewDotNormal, 1.45) * 0.80;
    float lightFacingBoost = 0.28 + ndl * 0.72;

    float sunGlint = (glintBroad + glintMid + glintTight) * glintBreakup;
    sunGlint *= glancingBoost * lightFacingBoost;

    vec3 sunGlintColor = vec3(1.0, 0.92, 0.78);

    return baseColor + sunGlintColor * sunGlint;
}

vec3 addCrestHighlight(vec3 baseColor, vec3 normal, float viewDotNormal, float ndl) {
    float waveSteepness = 1.0 - saturate(normal.y);

    float crestMask = smoothstep(0.030, 0.125, waveSteepness);

    vec2 animatedP = vPositionW.xz + vec2(time * 0.035, time * 0.028);

    float largeBreakup = fbm(animatedP * 0.34);
    float fineBreakup = fbm(animatedP * 1.28 + vec2(17.2, 4.8));

    float foamNoise = largeBreakup * 0.60 + fineBreakup * 0.40;
    float foamBreakup = smoothstep(0.45, 0.82, foamNoise);

    float angleBoost = 0.50 + pow(1.0 - viewDotNormal, 1.50) * 0.50;
    float lightBoost = 0.55 + ndl * 0.45;

    float foamAmount = crestMask * foamBreakup * angleBoost * lightBoost;
    foamAmount *= 0.23;

    vec3 foamColor = vec3(0.82, 0.94, 0.98);

    return mix(baseColor, foamColor, saturate(foamAmount));
}

vec3 shadeAboveWater(
    vec3 normal,
    vec3 viewRayW,
    vec3 viewToCameraW,
    vec3 sunDirectionW,
    vec2 screenUV,
    float rawDepth,
    float depthDelta,
    float thickness,
    bool backgroundDepth
) {
    float viewDotNormal = saturate(dot(viewToCameraW, normal));
    float ndl = saturate(dot(normal, sunDirectionW));

    vec3 reflectionDirection = reflect(viewRayW, normal);
    vec3 reflectedColor = sampleEnvironment(reflectionDirection);
    reflectedColor *= vec3(0.88, 0.96, 1.0);

    float fresnel = schlickFresnel(viewDotNormal, WATER_F0);

    /*
        Keep normal-incidence reflection subtle. The prior version could feel
        too closed/dark because transmission faded too quickly.
    */
    fresnel = saturate(fresnel * 0.92);

    float thickness01 = saturate(thickness / 32.0);

    float refractionStrength = mix(0.018, 0.006, thickness01);
    vec2 refractionOffset = normal.xz * refractionStrength;

    vec2 refractedUV = clamp(screenUV + refractionOffset, vec2(0.001), vec2(0.999));
    vec3 sceneColor = texture2D(textureSampler, refractedUV).rgb;

    vec3 volumeColor = waterVolumeColor(thickness, 0.0);

    vec3 transmittedColor;

    if (backgroundDepth) {
        transmittedColor = mix(volumeColor, vec3(0.018, 0.115, 0.190), 0.38);
    } else {
        vec3 absorbedScene = beerLambert(sceneColor, thickness);

        /*
            Tuning update:
            Higher scene visibility preserves seabed/rocks through shallow
            water instead of instantly replacing them with colored water.
        */
        float sceneVisibility = exp(-thickness * 0.034);
        sceneVisibility = max(sceneVisibility, 0.14 * (1.0 - thickness01));

        transmittedColor = mix(volumeColor, absorbedScene, sceneVisibility);
    }

    float softLight = 0.55 + ndl * 0.45;
    transmittedColor *= softLight;

    vec3 finalColor = mix(transmittedColor, reflectedColor, fresnel);

    float grazingVolume = pow(1.0 - viewDotNormal, 2.2) * 0.10;
    finalColor += vec3(0.010, 0.035, 0.055) * grazingVolume;

    vec3 halfVector = normalize(sunDirectionW + viewToCameraW);
    float specularTight = pow(saturate(dot(normal, halfVector)), 240.0) * 0.28;
    float specularWide = pow(saturate(dot(normal, halfVector)), 70.0) * 0.07;

    finalColor += vec3(1.0, 0.94, 0.84) * (specularTight + specularWide);
    finalColor = applySurfaceSunGlint(finalColor, normal, viewRayW, viewToCameraW, sunDirectionW, viewDotNormal, ndl);
    finalColor = addCrestHighlight(finalColor, normal, viewDotNormal, ndl);

    float cameraDistance = length(vPositionW - cameraPositionW);
    float horizonFade = smoothstep(220.0, 620.0, cameraDistance);
    float grazingHaze = pow(1.0 - viewDotNormal, 2.2) * 0.10 * horizonFade;
    float fogAmount = saturate(horizonFade * 0.22 + grazingHaze);

    vec3 horizonFogColor = vec3(0.42, 0.70, 0.92);
    finalColor = mix(finalColor, horizonFogColor, fogAmount);

    return softTonemap(finalColor * 1.28) * 1.24;
}

vec3 shadeUnderwater(
    vec3 normal,
    vec3 viewRayW,
    vec3 viewToCameraW,
    vec3 sunDirectionW,
    vec2 screenUV,
    float rawDepth,
    float depthDelta,
    float thickness,
    bool backgroundDepth
) {
    vec3 undersideNormal = -normal;

    float viewDotNormal = saturate(dot(viewToCameraW, undersideNormal));

    float tir = 1.0 - smoothstep(0.58, 0.72, viewDotNormal);
    float fresnel = schlickFresnel(viewDotNormal, WATER_F0);
    fresnel = max(fresnel, tir);

    vec3 reflectedUnderwater = texture2D(
        textureSampler,
        clamp(screenUV + normal.xz * 0.010, vec2(0.001), vec2(0.999))
    ).rgb;

    vec3 refractedDirection = refract(viewRayW, undersideNormal, WATER_TO_AIR_ETA);
    bool hasRefraction = length(refractedDirection) > 0.001;

    vec3 transmittedSky = sampleEnvironment(hasRefraction ? refractedDirection : reflect(viewRayW, undersideNormal));

    float sunThroughSurface = saturate(dot(hasRefraction ? refractedDirection : undersideNormal, sunDirectionW));
    float sunPatch = pow(sunThroughSurface, 38.0);
    float sunWideGlow = pow(sunThroughSurface, 6.5);

    float surfaceFacingSun = saturate(dot(normal, sunDirectionW) * 0.5 + 0.5);
    float waveFocus = smoothstep(0.12, 0.95, surfaceFacingSun);

    float depthFade = exp(-cameraDepthBelowSurface * 0.048);

    vec3 silverBlueSun = vec3(0.75, 0.96, 1.0) * sunPatch * 1.75 * waveFocus * depthFade;
    vec3 softSunGlow = vec3(0.32, 0.70, 1.0) * sunWideGlow * 0.42 * depthFade;

    float surfaceThickness = max(thickness * 0.14, cameraDepthBelowSurface * 0.42);
    vec3 transmittedSurface = beerLambert(transmittedSky, surfaceThickness);

    vec3 waterFallback = waterVolumeColor(cameraDepthBelowSurface * 1.15 + 3.0, saturate(cameraDepthBelowSurface / 42.0));
    transmittedSurface = backgroundDepth ? mix(waterFallback, transmittedSurface, 0.76) : transmittedSurface;

    vec3 underwaterReflection = mix(waterFallback, reflectedUnderwater, 0.48);
    underwaterReflection = beerLambert(underwaterReflection, cameraDepthBelowSurface * 0.10);

    vec3 finalColor = mix(transmittedSurface, underwaterReflection, fresnel);
    finalColor += silverBlueSun + softSunGlow;

    float depthDarken = saturate(cameraDepthBelowSurface / 50.0);
    vec3 deepWaterTint = vec3(0.010, 0.075, 0.125);

    finalColor = mix(finalColor, deepWaterTint, depthDarken * 0.34);

    float shimmer = fbm(vPositionW.xz * 1.45 + normal.xz * 12.0 + vec2(time * 0.10, -time * 0.07));
    shimmer = smoothstep(0.46, 0.88, shimmer);
    finalColor += vec3(0.07, 0.16, 0.20) * shimmer * (1.0 - fresnel) * depthFade * 0.20;

    return softTonemap(finalColor * 1.34) * 1.26;
}

void main() {
    vec3 normal = normalize(vNormalW);

    vec2 screenUV = getScreenUV();
    float rawDepth = texture2D(depthSampler, screenUV).r;

    bool backgroundDepth = isLikelyBackgroundDepth(rawDepth);

    vec3 viewRayW = normalize(vPositionW - cameraPositionW);
    vec3 viewToCameraW = -viewRayW;

    vec3 sunDirectionW = normalize(-lightDirection);

    if (dot(normal, viewToCameraW) < 0.0) {
        normal = -normal;
    }

    float depthDelta = estimateDepthSeparation(vPositionClip.z, rawDepth);
    float cameraDistance = length(vPositionW - cameraPositionW);
    float viewDotUp = dot(normalize(viewRayW), vec3(0.0, -1.0, 0.0));

    float thickness = estimateWaterThickness(depthDelta, viewDotUp, cameraDistance);
    thickness += cameraDepthBelowSurface * underwaterAmount * 0.48;

    vec3 aboveWaterColor = shadeAboveWater(
        normal,
        viewRayW,
        viewToCameraW,
        sunDirectionW,
        screenUV,
        rawDepth,
        depthDelta,
        thickness,
        backgroundDepth
    );

    vec3 underwaterColor = shadeUnderwater(
        normal,
        viewRayW,
        viewToCameraW,
        sunDirectionW,
        screenUV,
        rawDepth,
        depthDelta,
        thickness,
        backgroundDepth
    );

    vec3 finalColor = mix(aboveWaterColor, underwaterColor, saturate(underwaterAmount));

    gl_FragColor = vec4(saturateVec3(finalColor), 1.0);
}