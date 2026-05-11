precision highp float;

varying vec3 vNormalW;
varying vec3 vPositionW;
varying vec4 vPositionClip;

uniform vec3 cameraPositionW;
uniform vec3 lightDirection;

uniform sampler2D depthSampler;
uniform sampler2D textureSampler;
uniform samplerCube reflectionSampler;

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

void main() {
    vec3 normal = normalize(vNormalW);

    vec2 screenUV = vPositionClip.xy / vPositionClip.w;
    screenUV = screenUV * 0.5 + 0.5;

    float surfaceDepth = vPositionClip.z;
    float backgroundDepth = texture2D(depthSampler, screenUV).r;

    float distanceThroughWater = max(surfaceDepth - backgroundDepth, 0.0);
    float waterDepth = saturate(distanceThroughWater * 0.08);

    vec2 refractionOffset = normal.xz * 0.018 * (1.0 - waterDepth);
    vec2 refractedUV = clamp(screenUV + refractionOffset, vec2(0.001), vec2(0.999));

    vec3 backgroundColor = texture2D(textureSampler, refractedUV).rgb;

    vec3 shallowWaterColor = vec3(0.030, 0.185, 0.235);
    vec3 midWaterColor = vec3(0.010, 0.085, 0.145);
    vec3 deepWaterColor = vec3(0.004, 0.030, 0.065);

    vec3 waterColor = mix(shallowWaterColor, midWaterColor, waterDepth);
    waterColor = mix(waterColor, deepWaterColor, waterDepth * waterDepth);

    float backgroundVisibility = exp(-distanceThroughWater * 0.13);
    vec3 transmittedColor = mix(waterColor, backgroundColor, backgroundVisibility);

    vec3 viewRayW = normalize(vPositionW - cameraPositionW);
    vec3 viewToCameraW = -viewRayW;

    vec3 reflectedRayW = reflect(viewRayW, normal);
    vec3 reflectedColor = textureCube(reflectionSampler, reflectedRayW).rgb;

    reflectedColor = softTonemap(reflectedColor * 1.35);
    reflectedColor *= vec3(0.86, 0.94, 1.0);

    float viewDotNormal = saturate(dot(viewToCameraW, normal));

    float fresnel = 0.02 + 0.88 * pow(1.0 - viewDotNormal, 5.0);
    fresnel = saturate(fresnel);

    float ndl = saturate(dot(normal, -lightDirection));
    float softLight = 0.34 + ndl * 0.66;

    vec3 halfVector = normalize(-lightDirection + viewToCameraW);

    float specularTight = pow(saturate(dot(normal, halfVector)), 220.0) * 0.55;
    float specularWide = pow(saturate(dot(normal, halfVector)), 55.0) * 0.12;
    float specular = specularTight + specularWide;

    vec3 litWater = transmittedColor * softLight;

    vec3 finalColor = mix(litWater, reflectedColor, fresnel);

    finalColor += vec3(0.010, 0.025, 0.040) * pow(1.0 - viewDotNormal, 2.0);
    finalColor += vec3(specular);

    /*
        Crest highlight / subtle foam:
        This is stronger than the last pass, but still not beach foam.
        It should appear as thin white-blue breakup on sharper wave crests.
    */
    float waveSteepness = 1.0 - saturate(normal.y);

    float crestMask = smoothstep(0.018, 0.105, waveSteepness);

    float largeBreakup = fbm(vPositionW.xz * 0.36);
    float fineBreakup = fbm(vPositionW.xz * 1.35 + vec2(17.2, 4.8));

    float foamNoise = largeBreakup * 0.60 + fineBreakup * 0.40;
    float foamBreakup = smoothstep(0.42, 0.78, foamNoise);

    float angleBoost = 0.52 + pow(1.0 - viewDotNormal, 1.55) * 0.48;
    float lightBoost = 0.58 + ndl * 0.42;

    float foamAmount = crestMask * foamBreakup * angleBoost * lightBoost;

    foamAmount *= 0.48;

    vec3 foamColor = vec3(0.82, 0.93, 0.98);
    finalColor = mix(finalColor, foamColor, saturate(foamAmount));

    finalColor = softTonemap(finalColor * 1.15) * 1.25;

    /*
        Cool sky-blue horizon haze.
    */
    float cameraDistance = length(vPositionW - cameraPositionW);

    float horizonFade = smoothstep(96.0, 158.0, cameraDistance);
    float delayedHaze = pow(horizonFade, 1.65) * 0.84;

    float grazingHaze = pow(1.0 - viewDotNormal, 2.8) * 0.12 * horizonFade;

    float fogAmount = saturate(delayedHaze + grazingHaze);

    vec3 horizonFogColor = vec3(0.42, 0.70, 0.92);

    finalColor = mix(finalColor, horizonFogColor, fogAmount);

    gl_FragColor = vec4(saturateVec3(finalColor), 1.0);
}