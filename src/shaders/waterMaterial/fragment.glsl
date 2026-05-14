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
uniform float waterDebugMode;

uniform sampler2D depthSampler;
uniform sampler2D textureSampler;
uniform samplerCube reflectionSampler;

const float WATER_F0 = 0.020;
const float WATER_TO_AIR_ETA = 1.333;

/*
    Temporary scene-scale seabed approximation.

    The current demo seabed plane is at y = -10. This stabilizes water thickness
    until we replace it with reconstructed scene depth/world position.
*/
const float APPROX_SEABED_Y = -10.0;

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

bool isLikelyBackgroundDepth(float rawDepth) {
    return rawDepth <= 0.00001 || rawDepth >= 0.99999;
}

float estimatePlaneWaterPath(vec3 viewRayW, bool backgroundDepth) {
    float surfaceToBedVertical = max(waterLevel - APPROX_SEABED_Y, 0.0);

    float downward = max(-viewRayW.y, 0.08);
    float aboveWaterPath = surfaceToBedVertical / downward;

    aboveWaterPath = clamp(aboveWaterPath, 0.0, backgroundDepth ? 16.0 : 36.0);

    float upward = max(viewRayW.y, 0.18);
    float underwaterSurfacePath = cameraDepthBelowSurface / upward;
    underwaterSurfacePath = clamp(underwaterSurfacePath, 0.0, 20.0);

    return mix(aboveWaterPath, underwaterSurfacePath, saturate(underwaterAmount));
}

float estimateWaterThickness(float planePath, float rawDepth, bool backgroundDepth) {
    float depthModifier = 1.0;

    if (!backgroundDepth) {
        float centeredDepth = abs(rawDepth - 0.5) * 2.0;
        depthModifier = mix(0.72, 1.08, saturate(centeredDepth));
    }

    float thickness = planePath * depthModifier;

    return clamp(thickness, 0.0, 30.0);
}

vec3 sampleEnvironment(vec3 direction) {
    vec3 color = textureCube(reflectionSampler, normalize(direction)).rgb;

    /*
        Tropical surface:
        - brighter sky reflection
        - less gray/steel tonemapping
        - more blue preservation
    */
    color = softTonemap(color * 1.85) * 1.34;
    color *= vec3(0.86, 0.98, 1.16);

    return color;
}

vec3 beerLambert(vec3 color, float thickness) {
    /*
        Tropical clear-water absorption.
        Preserve blue/cyan brightness and shallow visibility.
    */
    vec3 absorption = vec3(0.032, 0.012, 0.0045);
    vec3 transmittance = exp(-absorption * thickness);

    return color * transmittance;
}

vec3 waterVolumeColor(float thickness, float depthBias) {
    /*
        Tropical body water color.
        This is intentionally brighter and more cyan than the earlier deep-ocean
        tuning.
    */
    vec3 shallow = vec3(0.030, 0.430, 0.500);
    vec3 mid = vec3(0.010, 0.255, 0.365);
    vec3 deep = vec3(0.004, 0.105, 0.220);

    float depth01 = saturate(thickness / 32.0 + depthBias);

    vec3 color = mix(shallow, mid, smoothstep(0.0, 0.76, depth01));
    color = mix(color, deep, smoothstep(0.62, 1.0, depth01));

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

    /*
        Softer tropical glints. The previous version was too steel/silver.
    */
    float glintBroad = pow(sunReflectionAlignment, 14.0) * 0.18;
    float glintMid = pow(sunReflectionAlignment, 38.0) * 0.30;
    float glintTight = pow(sunReflectionAlignment, 120.0) * 0.52;

    vec2 animatedP = vPositionW.xz + vec2(time * 0.08, -time * 0.045);

    float glintNoiseLarge = fbm(animatedP * 0.48 + normal.xz * 6.0);
    float glintNoiseFine = fbm(animatedP * 1.85 + normal.xz * 14.0 + vec2(12.7, 4.1));

    float glintBreakup = glintNoiseLarge * 0.60 + glintNoiseFine * 0.40;
    glintBreakup = smoothstep(0.30, 0.86, glintBreakup);

    float glancingBoost = 0.18 + pow(1.0 - viewDotNormal, 1.35) * 0.62;
    float lightFacingBoost = 0.34 + ndl * 0.66;

    float sunGlint = (glintBroad + glintMid + glintTight) * glintBreakup;
    sunGlint *= glancingBoost * lightFacingBoost;

    vec3 sunGlintColor = vec3(1.0, 0.92, 0.72);

    return baseColor + sunGlintColor * sunGlint;
}

vec3 addCrestHighlight(vec3 baseColor, vec3 normal, float viewDotNormal, float ndl) {
    float waveSteepness = 1.0 - saturate(normal.y);

    /*
        Tropical preset should not read like stormy whitewater.
        Keep only subtle crest sparkle for now.
    */
    float crestMask = smoothstep(0.040, 0.145, waveSteepness);

    vec2 animatedP = vPositionW.xz + vec2(time * 0.035, time * 0.028);

    float largeBreakup = fbm(animatedP * 0.30);
    float fineBreakup = fbm(animatedP * 1.05 + vec2(17.2, 4.8));

    float foamNoise = largeBreakup * 0.62 + fineBreakup * 0.38;
    float foamBreakup = smoothstep(0.48, 0.84, foamNoise);

    float angleBoost = 0.46 + pow(1.0 - viewDotNormal, 1.45) * 0.42;
    float lightBoost = 0.62 + ndl * 0.38;

    float foamAmount = crestMask * foamBreakup * angleBoost * lightBoost;
    foamAmount *= 0.13;

    vec3 foamColor = vec3(0.82, 0.96, 1.0);

    return mix(baseColor, foamColor, saturate(foamAmount));
}

vec3 shadeAboveWater(
    vec3 normal,
    vec3 viewRayW,
    vec3 viewToCameraW,
    vec3 sunDirectionW,
    vec2 screenUV,
    float rawDepth,
    float planePath,
    float thickness,
    bool backgroundDepth
) {
    float viewDotNormal = saturate(dot(viewToCameraW, normal));
    float ndl = saturate(dot(normal, sunDirectionW));

    vec3 reflectionDirection = reflect(viewRayW, normal);
    vec3 reflectedColor = sampleEnvironment(reflectionDirection);

    /*
        Keep reflection blue and glossy, not gray/metallic.
    */
    reflectedColor *= vec3(0.82, 0.98, 1.18);

    float fresnel = schlickFresnel(viewDotNormal, WATER_F0);

    /*
        Slightly reduce reflection away from grazing angles so tropical body
        color/transmission can dominate looking down.
    */
    fresnel = saturate(fresnel * 0.82);

    float thickness01 = saturate(thickness / 28.0);

    float refractionStrength = mix(0.014, 0.004, thickness01);
    vec2 refractionOffset = normal.xz * refractionStrength;

    vec2 refractedUV = clamp(screenUV + refractionOffset, vec2(0.001), vec2(0.999));
    vec3 sceneColor = texture2D(textureSampler, refractedUV).rgb;

    vec3 volumeColor = waterVolumeColor(thickness, 0.0);

    vec3 transmittedColor;

    if (backgroundDepth) {
        transmittedColor = mix(volumeColor, vec3(0.020, 0.220, 0.350), 0.26);
    } else {
        vec3 absorbedScene = beerLambert(sceneColor, thickness);

        /*
            Preserve shallow seabed visibility for tropical water.
        */
        float sceneVisibility = exp(-thickness * 0.018);
        sceneVisibility = max(sceneVisibility, 0.30 * (1.0 - thickness01));

        transmittedColor = mix(volumeColor, absorbedScene, sceneVisibility);
    }

    /*
        Tropical sunlit water should be brighter.
    */
    float softLight = 0.72 + ndl * 0.32;
    transmittedColor *= softLight;

    /*
        A small tropical scattering lift gives the water its cyan body without
        becoming a flat overlay.
    */
    vec3 tropicalScatter = vec3(0.000, 0.080, 0.120) * (1.0 - thickness01) * 0.55;
    transmittedColor += tropicalScatter;

    vec3 finalColor = mix(transmittedColor, reflectedColor, fresnel);

    float grazingVolume = pow(1.0 - viewDotNormal, 2.0) * 0.045;
    finalColor += vec3(0.000, 0.045, 0.080) * grazingVolume;

    vec3 halfVector = normalize(sunDirectionW + viewToCameraW);
    float specularTight = pow(saturate(dot(normal, halfVector)), 220.0) * 0.18;
    float specularWide = pow(saturate(dot(normal, halfVector)), 58.0) * 0.055;

    finalColor += vec3(1.0, 0.93, 0.76) * (specularTight + specularWide);
    finalColor = applySurfaceSunGlint(finalColor, normal, viewRayW, viewToCameraW, sunDirectionW, viewDotNormal, ndl);
    finalColor = addCrestHighlight(finalColor, normal, viewDotNormal, ndl);

    /*
        Tropical horizon haze should be blue/cyan and bright, not gray/navy.
    */
    float cameraDistance = length(vPositionW - cameraPositionW);
    float horizonFade = smoothstep(300.0, 880.0, cameraDistance);
    float grazingHaze = pow(1.0 - viewDotNormal, 2.0) * 0.055 * horizonFade;
    float fogAmount = saturate(horizonFade * 0.12 + grazingHaze);

    vec3 horizonFogColor = vec3(0.36, 0.72, 0.98);
    finalColor = mix(finalColor, horizonFogColor, fogAmount);

    /*
        More luminous tropical output.
    */
    return softTonemap(finalColor * 1.48) * 1.36;
}

vec3 shadeUnderwater(
    vec3 normal,
    vec3 viewRayW,
    vec3 viewToCameraW,
    vec3 sunDirectionW,
    vec2 screenUV,
    float rawDepth,
    float planePath,
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
    float sunPatch = pow(sunThroughSurface, 30.0);
    float sunWideGlow = pow(sunThroughSurface, 4.8);

    float surfaceFacingSun = saturate(dot(normal, sunDirectionW) * 0.5 + 0.5);
    float waveFocus = smoothstep(0.08, 0.95, surfaceFacingSun);

    float depthFade = exp(-cameraDepthBelowSurface * 0.030);

    vec3 silverBlueSun = vec3(0.82, 0.98, 1.0) * sunPatch * 2.25 * waveFocus * depthFade;
    vec3 softSunGlow = vec3(0.42, 0.82, 1.0) * sunWideGlow * 0.58 * depthFade;

    float surfaceThickness = max(thickness * 0.08, cameraDepthBelowSurface * 0.25);
    vec3 transmittedSurface = beerLambert(transmittedSky, surfaceThickness);

    vec3 waterFallback = waterVolumeColor(cameraDepthBelowSurface * 0.70 + 1.5, saturate(cameraDepthBelowSurface / 42.0));
    transmittedSurface = backgroundDepth ? mix(waterFallback, transmittedSurface, 0.86) : transmittedSurface;

    vec3 underwaterReflection = mix(waterFallback, reflectedUnderwater, 0.52);
    underwaterReflection = beerLambert(underwaterReflection, cameraDepthBelowSurface * 0.06);

    vec3 finalColor = mix(transmittedSurface, underwaterReflection, fresnel);
    finalColor += silverBlueSun + softSunGlow;

    float depthDarken = saturate(cameraDepthBelowSurface / 60.0);
    vec3 deepWaterTint = vec3(0.004, 0.075, 0.150);

    finalColor = mix(finalColor, deepWaterTint, depthDarken * 0.20);

    float shimmer = fbm(vPositionW.xz * 1.20 + normal.xz * 10.0 + vec2(time * 0.10, -time * 0.07));
    shimmer = smoothstep(0.46, 0.88, shimmer);
    finalColor += vec3(0.08, 0.20, 0.24) * shimmer * (1.0 - fresnel) * depthFade * 0.18;

    return softTonemap(finalColor * 1.52) * 1.36;
}

vec3 debugColor(
    float mode,
    float rawDepth,
    float planePath,
    float thickness,
    bool backgroundDepth,
    float fresnel
) {
    if (mode < 1.5) {
        return vec3(rawDepth);
    }

    if (mode < 2.5) {
        float v = saturate(planePath / 42.0);
        return mix(vec3(0.0, 0.04, 0.18), vec3(0.0, 0.8, 1.0), v);
    }

    if (mode < 3.5) {
        float v = saturate(thickness / 30.0);
        return mix(vec3(0.0, 0.05, 0.18), vec3(0.0, 0.9, 1.0), v);
    }

    if (mode < 4.5) {
        return backgroundDepth ? vec3(1.0, 0.0, 0.0) : vec3(0.0);
    }

    if (mode < 5.5) {
        return vec3(fresnel);
    }

    return vec3(saturate(underwaterAmount));
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

    float viewDotNormal = saturate(dot(viewToCameraW, normal));
    float fresnel = saturate(schlickFresnel(viewDotNormal, WATER_F0) * 0.82);

    float planePath = estimatePlaneWaterPath(viewRayW, backgroundDepth);
    float thickness = estimateWaterThickness(planePath, rawDepth, backgroundDepth);

    if (waterDebugMode > 0.5) {
        gl_FragColor = vec4(
            saturateVec3(debugColor(waterDebugMode, rawDepth, planePath, thickness, backgroundDepth, fresnel)),
            1.0
        );
        return;
    }

    vec3 aboveWaterColor = shadeAboveWater(
        normal,
        viewRayW,
        viewToCameraW,
        sunDirectionW,
        screenUV,
        rawDepth,
        planePath,
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
        planePath,
        thickness,
        backgroundDepth
    );

    vec3 finalColor = mix(aboveWaterColor, underwaterColor, saturate(underwaterAmount));

    gl_FragColor = vec4(saturateVec3(finalColor), 1.0);
}