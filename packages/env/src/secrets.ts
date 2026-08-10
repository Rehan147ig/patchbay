/**
 * Secret store abstraction. All credential material should be read through a
 * SecretStore so a deployment can swap the backing implementation (Vault,
 * KMS, cloud secret manager) without touching consumers.
 *
 * The default implementation is EnvSecretStore, backed by process.env — the
 * right fit for the local MVP. Errors never include secret values.
 */

export interface SecretStore {
  /** Resolves a secret by name; returns null when unset/blank. */
  get(name: string): Promise<string | null>;
  /** Resolves a secret or throws with a descriptive, value-free error. */
  getRequired(name: string): Promise<string>;
}

export interface SecretStoreOptions {
  source?: NodeJS.ProcessEnv;
}

/** Reads secrets from an environment object (process.env by default). */
export class EnvSecretStore implements SecretStore {
  private readonly source: NodeJS.ProcessEnv;

  constructor(options: SecretStoreOptions = {}) {
    this.source = options.source ?? process.env;
  }

  async get(name: string): Promise<string | null> {
    const value = this.source[name];
    return value === undefined || value.trim() === "" ? null : value;
  }

  async getRequired(name: string): Promise<string> {
    const value = await this.get(name);
    if (value === null) {
      throw new Error(`Required secret "${name}" is not set`);
    }
    return value;
  }
}

let singleton: SecretStore | null = null;

/**
 * Process-wide secret store. Env-backed today; replace the factory here when
 * a deployment moves to an external manager. Never import this at module
 * scope in libraries that run in tests — call it inside handlers.
 */
export function getSecretStore(): SecretStore {
  if (singleton === null) {
    singleton = new EnvSecretStore();
  }
  return singleton;
}
