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

float saturate(float v) {
    return clamp(v, 0.0, 1.0);
}

vec3 saturate3(vec3 v) {
    return clamp(v, vec3(0.0), vec3(1.0));
}

vec3 grayscale(vec3 color) {
    return vec3(dot(color, vec3(0.299, 0.587, 0.114)));
}

vec3 worldFromUV(vec2 pos, mat4 inverseProjection, mat4 inverseView) {
    vec4 ndc = vec4(pos.xy * 2.0 - 1.0, 1.0, 1.0);
    vec4 posVS = inverseProjection * ndc;
    vec4 posWS = inverseView * posVS;

    return posWS.xyz / posWS.w;
}

float getAboveWaterFogFactor(float depth, vec3 rayDir) {
    const float LOG2 = 1.442695;
    const float density = 400.0;
    const float start = 0.3;
    const float end = 1.0;

    float fogFactor = exp2(-density * density * depth * depth * LOG2);
    fogFactor = 1.0 - clamp((fogFactor - start) / (end - start), 0.0, 1.0);
    fogFactor *= pow(1.0 - abs(rayDir.y), 4.0);

    return fogFactor;
}

float getDistanceProxy(float rawDepth) {
    float farAmount = 1.0 - saturate(rawDepth);
    farAmount = pow(farAmount, 0.78);

    return mix(1.0, 135.0, farAmount);
}

vec2 underwaterDistortion(vec2 uv, float t, float depthBelowSurface) {
    float strength = 0.00022 + saturate(depthBelowSurface * 0.035) * 0.00062;

    float wave1 = sin(uv.y * 18.0 + t * 0.42);
    float wave2 = cos(uv.x * 16.0 - t * 0.35);
    float wave3 = sin((uv.x + uv.y) * 11.0 + t * 0.48);

    vec2 offset = vec2(
        wave1 * 0.55 + wave3 * 0.20,
        wave2 * 0.55 - wave3 * 0.14
    ) * strength;

    return clamp(uv + offset, vec2(0.001), vec2(0.999));
}

float causticPattern(vec2 p, float t) {
    float a = sin(p.x * 8.0 + t * 0.78);
    float b = sin(p.y * 10.0 - t * 0.68);
    float c = sin((p.x + p.y) * 6.5 + t * 0.52);
    float d = sin((p.x - p.y) * 7.0 - t * 0.58);

    float pattern = (a + b + c + d) * 0.25;
    pattern = pattern * 0.5 + 0.5;

    return smoothstep(0.70, 0.94, pattern);
}

void main() {
    float rawDepth = texture2D(depthSampler, vUV).r;
    vec3 baseColor = texture2D(textureSampler, vUV).rgb;

    /*
        Above water: preserve the original safe post-process look.
    */
    if (underwaterAmount < 0.001) {
        vec3 rayDir = normalize(worldFromUV(vUV, cameraInverseProjection, cameraInverseView) - cameraPosition);

        float fogFactor = getAboveWaterFogFactor(rawDepth, rayDir);
        vec3 fogColor = vec3(0.8);

        vec3 color = baseColor;

        const float exposure = 1.0;
        const float contrast = 1.0;
        const float brightness = 0.0;
        const float saturation = 1.3;

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

    /*
        Underwater controlled volume.
        This pass handles color grading, absorption, and depth falloff.
    */
    vec2 distortedUV = underwaterDistortion(vUV, time, cameraDepthBelowSurface);
    vec3 sceneColor = texture2D(textureSampler, distortedUV).rgb;

    float hasGeometry = step(0.00001, rawDepth);

    float luminance = dot(sceneColor, vec3(0.299, 0.587, 0.114));
    float redBrown = saturate(sceneColor.r - sceneColor.b);
    float brightLeak = smoothstep(0.58, 0.90, luminance);

    /*
        Bright leaks from sky/surface become water volume.
        We don't want white/gray atmosphere underwater.
    */
    float leakMask = brightLeak * (1.0 - hasGeometry * 0.35);

    float distanceProxy = getDistanceProxy(rawDepth);
    distanceProxy = mix(150.0, distanceProxy, hasGeometry);

    float cameraDepthFactor = smoothstep(0.0, 14.0, cameraDepthBelowSurface);
    float waterDistance = distanceProxy * (1.0 + cameraDepthFactor * 0.40);

    float farFactor = smoothstep(5.0, 95.0, waterDistance);

    /*
        New underwater palette:
        More teal-green, less gray.
    */
    vec3 shallowWaterColor = vec3(0.018, 0.245, 0.220);
    vec3 midWaterColor = vec3(0.006, 0.130, 0.125);
    vec3 deepWaterColor = vec3(0.001, 0.038, 0.050);

    vec3 bodyColor = mix(shallowWaterColor, midWaterColor, farFactor);
    bodyColor = mix(bodyColor, deepWaterColor, cameraDepthFactor * 0.68 + farFactor * 0.24);

    /*
        Absorption:
        Stronger red/brown removal so the sand feels submerged.
    */
    vec3 absorption = vec3(0.130, 0.060, 0.030);
    vec3 transmittance = exp(-absorption * waterDistance * 0.46);

    vec3 absorbedScene = sceneColor * transmittance;

    /*
        Remove dry-land brown especially with distance.
    */
    absorbedScene = mix(absorbedScene, absorbedScene * vec3(0.62, 0.92, 1.05), redBrown * 0.65);

    /*
        Empty/bright background becomes water body color.
    */
    absorbedScene = mix(bodyColor, absorbedScene, hasGeometry);
    absorbedScene = mix(absorbedScene, bodyColor, leakMask * 0.85);

    /*
        Depth fog:
        Far objects dissolve into water color.
    */
    float scatterAmount = 1.0 - exp(-waterDistance * 0.056);
    scatterAmount = saturate(scatterAmount);

    vec3 underwaterColor = mix(absorbedScene, bodyColor, scatterAmount);

    /*
        Keep only very near seabed detail.
    */
    float nearGeometry = hasGeometry * (1.0 - smoothstep(4.0, 30.0, waterDistance));
    underwaterColor += sceneColor * nearGeometry * 0.025;

    /*
        Distance/depth darkening.
    */
    float distanceDarkening = smoothstep(14.0, 110.0, waterDistance);
    float descentDarkening = smoothstep(2.5, 20.0, cameraDepthBelowSurface);

    underwaterColor *= 1.0 - distanceDarkening * 0.30;
    underwaterColor *= 1.0 - descentDarkening * 0.16;

    /*
        Near-surface teal light.
        This replaces the gray haze with actual water color.
    */
    float nearSurface = 1.0 - smoothstep(0.0, 7.0, cameraDepthBelowSurface);
    vec3 surfaceVolumeColor = vec3(0.035, 0.300, 0.260);

    underwaterColor = mix(underwaterColor, surfaceVolumeColor, nearSurface * leakMask * 0.65);
    underwaterColor += surfaceVolumeColor * nearSurface * 0.10;

    /*
        Subtle caustics on close geometry.
    */
    float causticMask = nearGeometry * nearSurface;

    vec2 causticUV = distortedUV * vec2(10.0, 7.0);
    causticUV += vec2(
        sin(time * 0.24) * 0.18,
        cos(time * 0.19) * 0.14
    );

    float caustics = causticPattern(causticUV, time);
    underwaterColor += vec3(0.065, 0.120, 0.080) * caustics * causticMask * 0.16;

    /*
        Keep saturation alive. Earlier versions died because of too much gray mix.
    */
    underwaterColor = mix(grayscale(underwaterColor), underwaterColor, 0.985);

    /*
        Soft vignette for depth.
    */
    vec2 centered = vUV * 2.0 - 1.0;
    float vignette = 1.0 - dot(centered, centered) * 0.055;
    underwaterColor *= clamp(vignette, 0.92, 1.0);

    vec3 finalColor = mix(baseColor, underwaterColor, underwaterAmount);

    gl_FragColor = vec4(saturate3(finalColor), 1.0);
}