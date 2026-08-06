// Auth0 configuration for the auth-gateway service.
// Values are loaded from environment variables at boot.
// See .env.example for the full list of required variables.
export const auth0Config = { domain: process.env.AUTH0_DOMAIN };

export interface Auth0Config {
  domain: string;
  clientId: string;
  clientSecret: string;
}
