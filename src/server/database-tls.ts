export function databaseTlsOptions() {
  const certificate = process.env.SUPABASE_DATABASE_CA;
  if (!certificate) return {};

  return {
    ssl: { ca: certificate.replaceAll("\\n", "\n"), rejectUnauthorized: true },
  };
}
