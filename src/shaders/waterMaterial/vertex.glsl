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

vec2 getSimulationUV(vec3 localPosition) {
    /*
        Repeat the FFT ocean tile across a much larger mesh.
        This lets us use one large ocean plane instead of many square tiles.
    */
    vec2 repeatedUV = localPosition.xz / tileSize;
    repeatedUV += vec2(0.5);
    return fract(repeatedUV);
}

vec3 sampleHeightAndGradient(vec2 point) {
    float height = texture(heightMap, point).r;
    vec2 gradient = texture(gradientMap, point).rg;

    return vec3(height, gradient) * scalingFactor;
}

void main() {
    scalingFactor = 1.0 / tileSize;

    vec3 waterPosition = position;

    vec2 simulationUV = getSimulationUV(position);

    vec2 displacement = texture(displacementMap, simulationUV).rg * scalingFactor * choppinessScale;
    waterPosition.x += displacement.x;
    waterPosition.z += displacement.y;

    vec3 heightAndGradient = sampleHeightAndGradient(simulationUV);

    waterPosition.y += heightAndGradient.x * waveHeightScale;

    vec2 normalGradient = heightAndGradient.yz * normalStrength;
    vec3 finalNormal = normalize(vec3(-normalGradient.x, 1.0, -normalGradient.y));

    vPositionW = vec3(world * vec4(waterPosition, 1.0));
    vNormalW = normalize(vec3(world * vec4(finalNormal, 0.0)));
    vPositionClip = worldViewProjection * vec4(waterPosition, 1.0);

    gl_Position = vPositionClip;
}