const CLERK_DEVICE_URL =
  "https://divine-fowl-6579.clerk.accounts.dev/oauth/device_authorization";

const WORD_ORIGIN = "https://localhost:3000";

// Route temporaire réservée au développement.
// Elle sera sécurisée davantage avant publication.
export const runtime = "nodejs";

function headers() {
  return {
    "Access-Control-Allow-Origin": WORD_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
    "Cache-Control": "no-store",
  };
}

export async function OPTIONS(request: Request) {
  if (
    process.env.NODE_ENV !== "development" ||
    request.headers.get("origin") !== WORD_ORIGIN
  ) {
    return new Response(null, { status: 403 });
  }

  return new Response(null, {
    status: 204,
    headers: headers(),
  });
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return Response.json({ error: "Route indisponible." }, { status: 404 });
  }

  if (request.headers.get("origin") !== WORD_ORIGIN) {
    return Response.json({ error: "Origine non autorisée." }, { status: 403 });
  }

  const clientId = process.env.THELYSON_WORD_OAUTH_CLIENT_ID;

  if (!clientId) {
    return Response.json(
      { error: "Client ID OAuth non configuré." },
      { status: 500, headers: headers() },
    );
  }

  try {
    const response = await fetch(CLERK_DEVICE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: clientId,
        scope: "openid profile",
      }),
      cache: "no-store",
    });

    const body = await response.text();

    return new Response(body, {
      status: response.status,
      headers: {
        ...headers(),
        "Content-Type": "application/json",
      },
    });
  } catch {
    return Response.json(
      { error: "Clerk est temporairement inaccessible." },
      { status: 502, headers: headers() },
    );
  }
}
