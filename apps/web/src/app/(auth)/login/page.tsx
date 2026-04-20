import { login } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const sp = await searchParams;
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <form action={login} className="w-full max-w-sm space-y-4 border rounded p-6 bg-white">
        <h1 className="text-2xl font-bold">Log in</h1>
        {sp.error ? (
          <p className="text-red-600 text-sm" data-testid="login-error">
            {sp.error}
          </p>
        ) : null}
        <input type="hidden" name="next" value={sp.next ?? "/admin"} />
        <label className="block space-y-1">
          <span className="text-sm">Email</span>
          <input
            name="email"
            type="email"
            required
            className="w-full border rounded px-3 py-2"
            autoComplete="email"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm">Password</span>
          <input
            name="password"
            type="password"
            required
            className="w-full border rounded px-3 py-2"
            autoComplete="current-password"
          />
        </label>
        <button className="w-full bg-black text-white rounded py-2" type="submit">
          Continue
        </button>
      </form>
    </main>
  );
}
