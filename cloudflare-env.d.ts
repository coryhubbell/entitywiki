declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    SCHEMABRAINS_API_KEY?: string;
    SCHEMABRAINS_BASE_URL?: string;
    OPERATOR_AUTH_MODE?: string;
    OPERATOR_LOCAL_KEY?: string;
    ACCESS_TEAM_DOMAIN?: string;
    ACCESS_AUDIENCE?: string;
    ACCESS_OPERATOR_EMAILS?: string;
    GOOGLE_BUSINESS_PROFILE_ACCESS_TOKEN?: string;
    BUCKET?: R2Bucket;
  }
}
