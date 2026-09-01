export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.OTEL_ENABLED === "1") {
    // Real OTel SDK would be initialized here (e.g. @opentelemetry/sdk-node).
    // Stub keeps CI/build green without the @opentelemetry dependency.
    console.log("[otel] instrumentation registered (stub)");
  }
}
