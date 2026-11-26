import { LoginForm } from "@/components/composer";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return <LoginForm admin ssoError={error} />;
}
