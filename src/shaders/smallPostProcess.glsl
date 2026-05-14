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

float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 19.19);

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

vec3 getWorldRay(vec2 uv) {
    vec4 ndc = vec4(uv * 2.0 - 1.0, 1.0, 1.0);
    vec4 viewPosition = cameraInverseProjection * ndc;
    viewPosition /= max(viewPosition.w, 0.00001);

    vec4 worldPosition = cameraInverseView * vec4(viewPosition.xyz, 1.0);

    return normalize(worldPosition.xyz - cameraPosition);
}

bool isLikelyBackgroundDepth(float depth) {
    return depth <= 0.00001 || depth >= 0.99999;
}

float estimateSceneDistance(float rawDepth, bool backgroundDepth) {
    if (backgroundDepth) {
        return 105.0;
    }

    float endpointDistance = min(rawDepth, 1.0 - rawDepth);
    float normalizedFar = 1.0 - saturate(endpointDistance * 2.0);

    float nearDistance = 2.0;
    float farDistance = 84.0;

    return mix(nearDistance, farDistance, normalizedFar);
}

vec3 adjustSaturation(vec3 color, float saturation) {
    float luma = dot(color, vec3(0.299, 0.587, 0.114));

    return mix(vec3(luma), color, saturation);
}

vec3 applyAboveWaterAtmosphere(vec3 color, float rawDepth, vec3 rayDir) {
    bool backgroundDepth = isLikelyBackgroundDepth(rawDepth);

    float sceneDistance = estimateSceneDistance(rawDepth, backgroundDepth);

    float horizontalLook = 1.0 - abs(rayDir.y);
    float upwardLook = saturate(rayDir.y);

    /*
        Keep above-water haze subtle and horizon-focused.
        This should not wash the whole image gray/white.
    */
    float horizonFactor = pow(horizontalLook, 3.0);
    float distanceFactor = backgroundDepth
        ? 1.0
        : smoothstep(58.0, 120.0, sceneDistance);

    float hazeAmount = horizonFactor * distanceFactor;

    /*
        Preserve upper sky saturation. Haze should live mostly near the horizon.
    */
    hazeAmount *= mix(1.0, 0.15, pow(upwardLook, 1.5));
    hazeAmount = saturate(hazeAmount * 0.22);

    vec3 tropicalBlueHaze = vec3(0.240, 0.610, 1.000);

    vec3 hazed = mix(color, tropicalBlueHaze, hazeAmount);

    /*
        Restore tropical saturation. Do not turn the scene gray/white.
    */
    hazed = adjustSaturation(hazed, 1.14);

    /*
        Small blue lift at the horizon only.
    */
    hazed += vec3(0.000, 0.010, 0.022) * horizonFactor * distanceFactor * 0.55;

    return saturateVec3(hazed);
}

vec3 applyTropicalAbsorption(vec3 color, float distanceThroughWater) {
    /*
        Gentler tropical absorption. We want contrast falloff,
        not deep-ocean blackening.
    */
    vec3 absorption = vec3(0.010, 0.0042, 0.0016);
    vec3 transmittance = exp(-absorption * distanceThroughWater);

    return color * transmittance;
}

vec3 getTropicalInscatterColor(float depth01, float upwardLook) {
    vec3 upperBlue = vec3(0.210, 0.560, 0.850);
    vec3 shallowCyan = vec3(0.085, 0.480, 0.525);
    vec3 midTurquoise = vec3(0.035, 0.310, 0.405);
    vec3 deeperBlue = vec3(0.012, 0.150, 0.270);

    vec3 color = mix(shallowCyan, midTurquoise, smoothstep(0.0, 0.72, depth01));
    color = mix(color, deeperBlue, smoothstep(0.62, 1.0, depth01));

    color = mix(color, upperBlue, pow(upwardLook, 1.25) * 0.72);

    return color;
}

vec3 applyUnderwaterVolume(vec3 color, float rawDepth, vec3 rayDir) {
    bool backgroundDepth = isLikelyBackgroundDepth(rawDepth);

    float sceneDistance = estimateSceneDistance(rawDepth, backgroundDepth);

    float cameraDepth01 = saturate(cameraDepthBelowSurface / 45.0);

    float upwardLook = saturate(rayDir.y);
    float downwardLook = saturate(-rayDir.y);
    float horizontalLook = 1.0 - abs(rayDir.y);

    /*
        Good tropical water has noticeable horizontal falloff,
        but the far color is luminous cyan/blue, not navy.
    */
    float horizontalBoost = mix(0.52, 1.34, pow(horizontalLook, 1.28));
    float distanceThroughWater = sceneDistance * horizontalBoost;

    distanceThroughWater *= mix(1.0, 0.18, pow(upwardLook, 2.0));
    distanceThroughWater *= mix(1.0, 0.72, pow(downwardLook, 1.35));

    distanceThroughWater += cameraDepthBelowSurface * 0.58;
    distanceThroughWater = clamp(distanceThroughWater, 0.0, 118.0);

    vec3 absorbed = applyTropicalAbsorption(color, distanceThroughWater);

    vec3 inscatterColor = getTropicalInscatterColor(cameraDepth01, upwardLook);

    /*
        Brighter/milkier tropical volume. More scattering,
        less dark extinction.
    */
    float horizontalFogBoost = mix(1.0, 1.30, pow(horizontalLook, 1.7));
    float fogDensity = mix(0.0042, 0.0088, cameraDepth01) * horizontalFogBoost;
    float fogAmount = 1.0 - exp(-distanceThroughWater * fogDensity);

    float milkyHaze = pow(horizontalLook, 1.55) * smoothstep(18.0, 100.0, distanceThroughWater);
    milkyHaze *= mix(1.0, 0.24, pow(upwardLook, 1.55));

    float horizonExtinction = pow(horizontalLook, 1.95);
    horizonExtinction *= smoothstep(24.0, 126.0, distanceThroughWater);

    float verticalDistanceFromCenter = abs(vUV.y - 0.5) * 2.0;
    float centerBandSoftener = mix(0.84, 1.0, smoothstep(0.10, 0.85, verticalDistanceFromCenter));
    horizonExtinction *= centerBandSoftener;

    if (backgroundDepth) {
        horizonExtinction = max(horizonExtinction, 0.38 + cameraDepth01 * 0.12);
        fogAmount = max(fogAmount, 0.30 + cameraDepth01 * 0.12);
        milkyHaze = max(milkyHaze, 0.30 + cameraDepth01 * 0.10);
    }

    float upwardPreserve = pow(upwardLook, 1.65);
    fogAmount *= mix(1.0, 0.28, upwardPreserve);
    horizonExtinction *= mix(1.0, 0.18, upwardPreserve);
    milkyHaze *= mix(1.0, 0.18, upwardPreserve);

    float particulate = fbm(vUV * vec2(18.0, 10.0) + vec2(time * 0.018, -time * 0.011));
    float particulateAmount = (particulate - 0.5) * 0.012 * underwaterAmount;

    fogAmount = saturate(fogAmount + particulateAmount);

    vec3 volumeColor = mix(absorbed, inscatterColor, fogAmount);

    /*
        Milky haze color closer to a tropical water screenshot.
    */
    vec3 milkyColor = vec3(0.130, 0.470, 0.520);
    volumeColor = mix(volumeColor, milkyColor, saturate(milkyHaze * 0.34));

    /*
        Tropical horizon color: darker than nearby water, but not navy.
    */
    vec3 horizonTropicalColor = mix(
        vec3(0.025, 0.230, 0.340),
        vec3(0.010, 0.125, 0.245),
        saturate(cameraDepthBelowSurface / 28.0)
    );

    volumeColor = mix(volumeColor, horizonTropicalColor, saturate(horizonExtinction * 0.48));

    /*
        Preserve local seabed/objects so the foreground does not become
        a flat color wash.
    */
    float shallowPreserve = exp(-cameraDepthBelowSurface * 0.18) * (1.0 - saturate(horizonExtinction * 0.76));
    volumeColor = mix(volumeColor, color, shallowPreserve * 0.26);

    /*
        Stronger bright top-water contribution.
    */
    float nearSurfaceLight = exp(-cameraDepthBelowSurface * 0.13);
    vec3 surfaceLightColor = vec3(0.080, 0.245, 0.280);

    volumeColor += surfaceLightColor * nearSurfaceLight * (0.38 + pow(upwardLook, 1.1) * 1.45);

    /*
        Very gentle depth darkening only.
    */
    vec3 deepTint = vec3(0.006, 0.070, 0.145);
    volumeColor = mix(volumeColor, deepTint, cameraDepth01 * 0.055);

    float contrast = mix(1.03, 0.94, cameraDepth01);
    volumeColor = (volumeColor - 0.5) * contrast + 0.5;

    volumeColor = adjustSaturation(volumeColor, 1.14);

    return saturateVec3(volumeColor);
}

void main() {
    vec3 color = texture2D(textureSampler, vUV).rgb;
    float rawDepth = texture2D(depthSampler, vUV).r;

    vec3 rayDir = getWorldRay(vUV);

    float underwaterBlend = saturate(underwaterAmount);

    vec3 aboveWaterColor = applyAboveWaterAtmosphere(color, rawDepth, rayDir);
    vec3 underwaterColor = applyUnderwaterVolume(color, rawDepth, rayDir);

    float transition = smoothstep(0.0, 1.0, underwaterBlend);

    color = mix(aboveWaterColor, underwaterColor, transition);

    gl_FragColor = vec4(saturateVec3(color), 1.0);
}