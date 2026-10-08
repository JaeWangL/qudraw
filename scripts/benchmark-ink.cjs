/* Reproduce geometric lag only. This is not a device performance benchmark. */
const { getStrokePoints } = require("perfect-freehand");
const input = Array.from({ length: 21 }, (_, index) => [index * 5, 0, 0.5]);
const results = [0.5, 0.1, 0].map((streamline) => {
  const points = getStrokePoints(input, {
    size: 2.125,
    streamline,
    last: false,
  });
  const endpoint = points[points.length - 1].point;
  return {
    streamline,
    rawEndpoint: input[input.length - 1].slice(0, 2),
    centerlineEndpoint: endpoint,
    spatialLagPx: Math.hypot(100 - endpoint[0], endpoint[1]),
  };
});
console.log(JSON.stringify({
  kind: "synthetic-centerline-spatial-lag",
  library: "perfect-freehand@1.2.0",
  inputCount: input.length,
  inputSpacingPx: 5,
  results,
  limitation: "No measurement of iPad input or physical pen-to-photon latency.",
}, null, 2));
