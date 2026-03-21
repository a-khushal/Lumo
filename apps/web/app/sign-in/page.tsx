import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { getSession, signInWithEmail } from "../../lib/auth";

export const dynamic = "force-dynamic";

type SignInPageProps = {
  searchParams: Promise<{ error?: string }>;
};

const loginWithEmail = async (formData: FormData) => {
  "use server";

  const email = formData.get("email");

  if (typeof email !== "string" || email.trim().length === 0) {
    redirect("/sign-in?error=Missing%20email");
  }

  try {
    await signInWithEmail(email, "/");
  } catch (error) {
    if (error instanceof AuthError) {
      redirect(`/sign-in?error=${encodeURIComponent(error.type)}`);
    }

    throw error;
  }
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const session = await getSession();

  if (session?.user?.email) {
    redirect("/");
  }

  const params = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl items-center px-5 py-12 sm:px-8">
      <section className="w-full rounded-2xl border border-border bg-panel p-6 shadow-card sm:p-8">
        <p className="text-xs font-bold uppercase tracking-[0.08em] text-accent-strong">
          Docs MVP
        </p>
        <h1 className="mt-1 text-3xl font-semibold text-ink">Sign in</h1>
        <p className="mt-2 text-sm text-muted">
          Enter any email to continue. We create an account automatically.
        </p>

        {params.error ? (
          <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {params.error}
          </p>
        ) : null}

        <form action={loginWithEmail} className="mt-5 grid gap-3">
          <label className="grid gap-1.5 text-sm text-ink" htmlFor="email">
            Email
            <input
              id="email"
              name="email"
              type="email"
              className="rounded-xl border border-border bg-panel px-3 py-2 text-sm text-ink outline-none ring-accent/40 transition focus:ring-2"
              placeholder="you@company.com"
              required
            />
          </label>

          <button
            type="submit"
            className="mt-2 rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-strong"
          >
            Continue
          </button>
        </form>
      </section>
    </main>
  );
}
