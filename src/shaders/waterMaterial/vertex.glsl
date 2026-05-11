precision highp float;

attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;

uniform mat4 world;
uniform mat4 worldViewProjection;

uniform sampler2D heightMap;
uniform sampler2D gradientMap;
uniform sampler2D displacementMap;

uniform float tileSize;
uniform float waveHeightScale;
uniform float choppinessScale;
uniform float normalStrength;

varying vec3 vNormalW;
varying vec3 vPositionW;
varying vec4 vPositionClip;

float scalingFactor;

vec2 rotate2D(vec2 point, float angle) {
    float c = cos(angle);
    float s = sin(angle);

    return vec2(
        point.x * c - point.y * s,
        point.x * s + point.y * c
    );
}

vec2 getSimulationUV(vec2 localXZ, float scale, float angle, vec2 offset) {
    vec2 rotated = rotate2D(localXZ, angle);
    vec2 repeatedUV = rotated / (tileSize * scale);

    return fract(repeatedUV + offset);
}

vec3 sampleHeightAndGradient(vec2 point) {
    float height = texture(heightMap, point).r;
    vec2 gradient = texture(gradientMap, point).rg;

    return vec3(height, gradient) * scalingFactor;
}

vec2 sampleDisplacementLayer(vec2 localXZ, float scale, float angle, vec2 offset, float weight) {
    vec2 simulationUV = getSimulationUV(localXZ, scale, angle, offset);

    /*
        Displacement is sampled in the rotated layer direction, then rotated
        back into the local water plane so each layer contributes a different
        natural direction.
    */
    vec2 displacement = texture(displacementMap, simulationUV).rg;
    displacement = rotate2D(displacement, -angle);

    return displacement * weight;
}

vec3 sampleHeightGradientLayer(vec2 localXZ, float scale, float angle, vec2 offset, float weight) {
    vec2 simulationUV = getSimulationUV(localXZ, scale, angle, offset);

    vec3 heightGradient = sampleHeightAndGradient(simulationUV);

    /*
        Height can layer directly. Gradients need to rotate back and weaken
        slightly for larger-scale layers so normals do not get overcooked.
    */
    vec2 rotatedGradient = rotate2D(heightGradient.yz, -angle) / scale;

    return vec3(heightGradient.x * weight, rotatedGradient * weight);
}

void main() {
    scalingFactor = 1.0 / tileSize;

    vec3 waterPosition = position;
    vec2 localXZ = position.xz;

    /*
        Multi-scale wave sampling:
        This breaks up the obvious repeated FFT tile pattern without touching
        the stable scene setup. It gives us main swell + cross chop + soft large motion.
    */
    vec2 displacement = vec2(0.0);

    displacement += sampleDisplacementLayer(localXZ, 1.00, 0.00, vec2(0.50, 0.50), 0.64);
    displacement += sampleDisplacementLayer(localXZ, 2.35, 0.78, vec2(0.17, 0.71), 0.25);
    displacement += sampleDisplacementLayer(localXZ, 4.75, -0.52, vec2(0.63, 0.29), 0.11);

    waterPosition.x += displacement.x * scalingFactor * choppinessScale;
    waterPosition.z += displacement.y * scalingFactor * choppinessScale;

    vec3 heightAndGradient = vec3(0.0);

    heightAndGradient += sampleHeightGradientLayer(localXZ, 1.00, 0.00, vec2(0.50, 0.50), 0.64);
    heightAndGradient += sampleHeightGradientLayer(localXZ, 2.35, 0.78, vec2(0.17, 0.71), 0.25);
    heightAndGradient += sampleHeightGradientLayer(localXZ, 4.75, -0.52, vec2(0.63, 0.29), 0.11);

    waterPosition.y += heightAndGradient.x * waveHeightScale;

    vec2 normalGradient = heightAndGradient.yz * normalStrength;
    vec3 finalNormal = normalize(vec3(-normalGradient.x, 1.0, -normalGradient.y));

    vPositionW = vec3(world * vec4(waterPosition, 1.0));
    vNormalW = normalize(vec3(world * vec4(finalNormal, 0.0)));
    vPositionClip = worldViewProjection * vec4(waterPosition, 1.0);

    gl_Position = vPositionClip;
}