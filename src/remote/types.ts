export interface RemoteTarget {
  host: string;
  port: number;
}

export interface RemoteAuth {
  user: string;
  password: string;
}

/** A preconfigured fleet of deployment targets sharing one set of credentials. */
export interface RemoteConfig {
  targets: RemoteTarget[];
  auth: RemoteAuth;
}

