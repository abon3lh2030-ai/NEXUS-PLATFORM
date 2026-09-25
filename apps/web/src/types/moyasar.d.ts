// The package ships types that aren't reachable through its "exports" map; declare the surface we use.
declare module 'moyasar-payment-form' {
  const Moyasar: { init(config: unknown): void };
  export default Moyasar;
}
