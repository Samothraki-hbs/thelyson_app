const CLERK_TOKEN_URL =
  "https://divine-fowl-6579.clerk.accounts.dev/oauth/token";

const WORD_ORIGIN = "https://localhost:3000";

const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

// Cette passerelle est réservée au développement local.
export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": WORD_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
  Vary: "Origin",
};

export async function OPTIONS(request: Request) {
  if (
    process.env.NODE_ENV !== "development" ||
    request.headers.get("origin") !== WORD_ORIGIN
  ) {
    return new Response(null, { status: 403 });
  }

  return new Response(null, {
    status: 204,
    headers: corsHeaders,
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
      { status: 500, headers: corsHeaders },
    );
  }

  try {
    const requestBody = await request.text();

    if (requestBody.length > 4096) {
      return Response.json(
        { error: "Requête trop volumineuse." },
        { status: 413, headers: corsHeaders },
      );
    }

    const params = new URLSearchParams(requestBody);

    const deviceCode = params.get("device_code");
    const grantType = params.get("grant_type");
    const requestedClientId = params.get("client_id");

    if (
      !deviceCode ||
      grantType !== DEVICE_GRANT ||
      requestedClientId !== clientId
    ) {
      return Response.json(
        { error: "Paramètres OAuth invalides." },
        { status: 400, headers: corsHeaders },
      );
    }

    const clerkResponse = await fetch(CLERK_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: DEVICE_GRANT,
        client_id: clientId,
        device_code: deviceCode,
      }),
      cache: "no-store",
    });

    const responseBody = await clerkResponse.text();

    return new Response(responseBody, {
      status: clerkResponse.status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  } catch {
    return Response.json(
      { error: "Impossible de contacter Clerk." },
      { status: 502, headers: corsHeaders },
    );
  }
}
