/**
 * Thélyson — Complément Microsoft Word
 *
 * Première fonctionnalité :
 * lire localement le document Word ouvert.
 *
 * Aucun envoi vers Supabase ou Tatum.
 */

const MAX_DOCUMENT_SIZE = 20 * 1024 * 1024;

// Récupérer le nom du document, s'il est disponible.
function getDocumentName(): string {
  const url = Office.context.document.url;

  if (!url) {
    return "Document Word non enregistré";
  }

  const filename = url.split(/[\\/]/).pop();

  if (!filename) {
    return "Document Word ouvert";
  }

  try {
    return decodeURIComponent(filename);
  } catch {
    return filename;
  }
}

// Récupérer une portion du fichier Word.
function readSlice(file: Office.File, index: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    file.getSliceAsync(index, (result) => {
      if (result.status !== Office.AsyncResultStatus.Succeeded) {
        reject(new Error(result.error?.message ?? "Impossible de lire une partie du document."));
        return;
      }

      resolve(Uint8Array.from(result.value.data as number[]));
    });
  });
}

// Lire le document Word entier au format DOCX.
function readWordDocument(): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    Office.context.document.getFileAsync(
      Office.FileType.Compressed,
      { sliceSize: 65536 },
      (result) => {
        if (result.status !== Office.AsyncResultStatus.Succeeded) {
          reject(new Error(result.error?.message ?? "Impossible d'accéder au document Word."));
          return;
        }

        const file = result.value;

        // Lire les morceaux successivement.
        async function collectDocument() {
          try {
            if (file.size <= 0 || file.size > MAX_DOCUMENT_SIZE) {
              throw new Error("Ce document dépasse la limite actuelle de 20 Mo.");
            }

            const bytes = new Uint8Array(file.size);
            let offset = 0;

            for (let index = 0; index < file.sliceCount; index++) {
              const slice = await readSlice(file, index);

              bytes.set(slice, offset);
              offset += slice.length;
            }

            if (offset !== file.size) {
              throw new Error("Le document n'a pas été lu complètement.");
            }

            return bytes;
          } finally {
            // Libérer le fichier temporaire Office.
            file.closeAsync();
          }
        }

        collectDocument().then(resolve).catch(reject);
      }
    );
  });
}

async function testerChiffrementLocal(documentBytes: Uint8Array): Promise<void> {
  // Générer une clé AES-256 temporaire, non exportable.
  const key = await crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"]
  );

  // Un IV aléatoire de 12 octets pour ce chiffrement.
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Préparer une copie exacte des octets du document.
  const original = new ArrayBuffer(documentBytes.byteLength);
  new Uint8Array(original).set(documentBytes);

  // Chiffrer le document localement.
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, original);

  // Déchiffrer pour vérifier l'intégrité.
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted);

  const recoveredBytes = new Uint8Array(decrypted);

  if (recoveredBytes.length !== documentBytes.length) {
    throw new Error("Le document déchiffré n'a pas la taille attendue.");
  }

  for (let i = 0; i < documentBytes.length; i++) {
    if (recoveredBytes[i] !== documentBytes[i]) {
      throw new Error("Le document déchiffré diffère du document original.");
    }
  }
}

type WordEncryptedManuscript = {
  encryptedBlob: Blob;
  fileHash: string;
  ivBase64: string;
  wrappedKeyBase64: string;
};

async function preparerManuscritWord(
  documentBytes: Uint8Array,
  publicKeyJwk: JsonWebKey
): Promise<WordEncryptedManuscript> {
  // 1. Conserver une copie exacte du document Word.
  const originalBuffer = new ArrayBuffer(documentBytes.byteLength);
  new Uint8Array(originalBuffer).set(documentBytes);

  // 2. Calculer son empreinte SHA-256.
  const hashBuffer = await crypto.subtle.digest("SHA-256", originalBuffer);

  const fileHash = Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  // 3. Générer une clé AES-256 exportable pour RSA.
  const aesKey = await crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    true,
    ["encrypt", "decrypt"]
  );

  // 4. Générer un IV aléatoire de 12 octets.
  const iv = new ArrayBuffer(12);
  crypto.getRandomValues(new Uint8Array(iv));

  // 5. Chiffrer le document Word.
  const encryptedBuffer = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      tagLength: 128,
    },
    aesKey,
    originalBuffer
  );

  // 6. Importer la clé publique RSA de l'utilisateur.
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    publicKeyJwk,
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    false,
    ["wrapKey"]
  );

  // 7. Protéger la clé AES avec RSA-OAEP.
  const wrappedKey = await crypto.subtle.wrapKey("raw", aesKey, publicKey, "RSA-OAEP");

  // 8. Encoder les métadonnées dans le format Thélyson.
  const ivBase64 = btoa(String.fromCharCode(...new Uint8Array(iv)));

  const wrappedKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(wrappedKey)));

  // 9. Préparer le fichier chiffré.
  const encryptedBlob = new Blob([encryptedBuffer], {
    type: "application/octet-stream",
  });

  return {
    encryptedBlob,
    fileHash,
    ivBase64,
    wrappedKeyBase64,
  };
}

// Initialiser le panneau lorsque Word est prêt.
Office.onReady((info) => {
  if (info.host !== Office.HostType.Word) {
    return;
  }

  const loadingMessage = document.getElementById("sideload-msg");

  const appBody = document.getElementById("app-body");

  const documentName = document.getElementById("document-name");

  const button = document.getElementById("check-document") as HTMLButtonElement | null;

  const notice = document.getElementById("status");

  // Afficher l'interface Thélyson.
  if (loadingMessage) {
    loadingMessage.style.display = "none";
  }

  if (appBody) {
    appBody.style.display = "block";
  }

  let wordPublicKeyJwk: JsonWebKey | null = null;

  // Navigation entre les deux modes de projet.
  const newProjectTab = document.getElementById("new-project-tab");
  const existingProjectTab = document.getElementById("existing-project-tab");

  const newProjectSection = document.getElementById("new-project-section");

  const existingProjectSection = document.getElementById("existing-project-section");

  function afficherModeProjet(mode: "new" | "existing") {
    if (!newProjectSection || !existingProjectSection) {
      return;
    }

    const nouveauProjet = mode === "new";

    // Afficher uniquement la section sélectionnée.
    newProjectSection.hidden = !nouveauProjet;
    existingProjectSection.hidden = nouveauProjet;

    newProjectSection.style.display = nouveauProjet ? "block" : "none";

    existingProjectSection.style.display = nouveauProjet ? "none" : "block";

    // Mettre à jour l'état des boutons.
    newProjectTab?.setAttribute("aria-pressed", String(nouveauProjet));

    existingProjectTab?.setAttribute("aria-pressed", String(!nouveauProjet));
  }

  newProjectTab?.addEventListener("click", (event) => {
    event.preventDefault();
    afficherModeProjet("new");
  });

  existingProjectTab?.addEventListener("click", (event) => {
    event.preventDefault();
    afficherModeProjet("existing");
  });

  // Mode affiché au démarrage.
  afficherModeProjet("new");

  // -------------------------------------------
  // Connexion Clerk depuis Microsoft Word
  // -------------------------------------------

  const CLERK_DEVICE_URL = "https://localhost:3001/api/word/oauth/device";

  const CLERK_TOKEN_URL = "https://localhost:3001/api/word/oauth/token";

  // Remplacer uniquement par le Client ID PUBLIC
  // de l'application OAuth Thélyson Word.
  const WORD_CLIENT_ID = "WcSO4hx6OmXFZKTT";

  const connectButton = document.getElementById("word-connect") as HTMLButtonElement | null;

  const browserButton = document.getElementById("word-open-browser") as HTMLButtonElement | null;

  const authorizationBox = document.getElementById("word-authorization");

  const userCodeElement = document.getElementById("word-user-code");

  const verificationLink = document.getElementById(
    "word-verification-link"
  ) as HTMLAnchorElement | null;

  const authStatus = document.getElementById("word-auth-status");

  if (
    connectButton &&
    browserButton &&
    authorizationBox &&
    userCodeElement &&
    verificationLink &&
    authStatus
  ) {
    let accessToken: string | null = null;
    let verificationUrl = "";

    function showAuthStatus(message: string) {
      if (authStatus) {
        authStatus.textContent = message;
      }
    }
    async function chargerProjetsWord(accessToken: string): Promise<void> {
      const response = await fetch("https://localhost:3001/api/word/projects", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        cache: "no-store",
      });

      const result = (await response.json()) as {
        projects?: Array<{
          id: string;
          title: string;
          created_at: string;
        }>;
        publicKeyJwk?: JsonWebKey | null;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(
          `Projets (HTTP ${response.status}) : ${result.error ?? "Erreur inconnue."}`
        );
      }

      const projects = result.projects ?? [];

      // Réinitialiser la clé éventuellement chargée précédemment.
      wordPublicKeyJwk = null;

      let rsaStatus = "Clé publique RSA absente.";

      if (result.publicKeyJwk) {
        try {
          // Vérifier que Word peut importer la clé publique.
          const publicKey = await crypto.subtle.importKey(
            "jwk",
            result.publicKeyJwk,
            {
              name: "RSA-OAEP",
              hash: "SHA-256",
            },
            false,
            ["wrapKey"]
          );

          // Vérifier la longueur de clé utilisée par Thélyson.
          const algorithm = publicKey.algorithm as RsaHashedKeyAlgorithm;

          if (algorithm.modulusLength !== 3072) {
            throw new Error("Longueur de clé RSA incompatible.");
          }

          // Conserver la clé publique validée pour la suite.
          wordPublicKeyJwk = result.publicKeyJwk;

          rsaStatus = "Clé publique RSA prête.";
        } catch {
          rsaStatus = "Clé publique RSA invalide ou incompatible.";
        }
      }

      // Retrouver la section « Utiliser un projet existant ».
      const existingSection = document.getElementById("existing-project-section");

      if (!existingSection) {
        throw new Error("La section des projets existants est introuvable.");
      }

      // Créer une zone de sélection, sans modifier le HTML existant.
      let selectionZone = document.getElementById("word-projects-selection");

      if (!selectionZone) {
        selectionZone = document.createElement("div");
        selectionZone.id = "word-projects-selection";
        selectionZone.style.marginTop = "16px";
        existingSection.appendChild(selectionZone);
      }

      // Éviter de dupliquer la liste lors d'une nouvelle connexion.
      selectionZone.replaceChildren();

      if (projects.length === 0) {
        const emptyMessage = document.createElement("p");

        emptyMessage.textContent = "Aucun projet existant. Vous pouvez créer un nouveau projet.";

        emptyMessage.style.fontSize = "13px";
        emptyMessage.style.color = "#71717a";

        selectionZone.appendChild(emptyMessage);
      } else {
        // Libellé du sélecteur.
        const label = document.createElement("label");

        label.htmlFor = "word-project-select";
        label.textContent = "Choisir un projet Thélyson";
        label.style.display = "block";
        label.style.fontSize = "13px";
        label.style.fontWeight = "600";
        label.style.marginBottom = "8px";

        // Liste déroulante.
        const select = document.createElement("select");

        select.id = "word-project-select";
        select.style.width = "100%";
        select.style.padding = "10px";
        select.style.border = "1px solid #d4d4d8";
        select.style.borderRadius = "8px";
        select.style.backgroundColor = "#ffffff";
        select.style.fontSize = "14px";

        const placeholder = document.createElement("option");

        placeholder.value = "";
        placeholder.textContent = "Sélectionner un projet";

        select.appendChild(placeholder);

        // Ajouter les projets réellement accessibles à l'utilisateur.
        for (const project of projects) {
          const option = document.createElement("option");

          option.value = project.id;
          option.textContent = project.title;

          select.appendChild(option);
        }

        selectionZone.append(label, select);
      }

      showAuthStatus(`Compte connecté. ${projects.length} projet(s) accessible(s). ${rsaStatus}`);
    }

    function delay(ms: number): Promise<void> {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    // Attendre la validation de l'utilisateur
    // en respectant la fréquence imposée par Clerk.
    async function pollAuthorization(
      deviceCode: string,
      intervalSeconds: number,
      expiresInSeconds: number
    ): Promise<string> {
      let pollingDelay = Math.max(5, intervalSeconds) * 1000;

      const deadline = Date.now() + expiresInSeconds * 1000;

      while (Date.now() < deadline) {
        await delay(pollingDelay);

        const response = await fetch(CLERK_TOKEN_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            client_id: WORD_CLIENT_ID,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            device_code: deviceCode,
          }),
        });

        const result = (await response.json()) as {
          access_token?: string;
          error?: string;
          error_description?: string;
        };

        if (response.ok && typeof result.access_token === "string") {
          return result.access_token;
        }

        if (result.error === "authorization_pending") {
          continue;
        }

        if (result.error === "slow_down") {
          pollingDelay += 5000;
          continue;
        }

        if (result.error === "access_denied") {
          throw new Error("L'autorisation a été refusée.");
        }

        if (result.error === "expired_token") {
          throw new Error("Le délai de connexion a expiré.");
        }

        throw new Error(
          result.error_description ?? result.error ?? "La connexion à Clerk a échoué."
        );
      }

      throw new Error("La demande de connexion a expiré.");
    }

    browserButton.addEventListener("click", () => {
      if (verificationUrl) {
        Office.context.ui.openBrowserWindow(verificationUrl);
      }
    });

    connectButton.addEventListener("click", async () => {
      if (accessToken) {
        showAuthStatus("Votre compte Thélyson est connecté.");
        return;
      }

      if (!WORD_CLIENT_ID || WORD_CLIENT_ID.trim() === "" || WORD_CLIENT_ID.startsWith("COLLER_")) {
        showAuthStatus("Renseignez le Client ID OAuth dans taskpane.ts.");
        return;
      }

      connectButton.disabled = true;
      authorizationBox.hidden = true;

      showAuthStatus("Préparation de la connexion sécurisée...");

      try {
        const response = await fetch(CLERK_DEVICE_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            client_id: WORD_CLIENT_ID,
            scope: "openid profile",
          }),
        });

        const result = (await response.json()) as {
          device_code?: string;
          user_code?: string;
          verification_uri?: string;
          verification_uri_complete?: string;
          interval?: number;
          expires_in?: number;
          error?: string;
          error_description?: string;
        };

        if (
          !response.ok ||
          !result.device_code ||
          !result.user_code ||
          !result.verification_uri ||
          !result.expires_in
        ) {
          throw new Error(
            `Clerk (HTTP ${response.status}) : ${
              result.error_description ??
              result.error ??
              "Réponse refusée ou informations de connexion manquantes."
            }`
          );
        }

        verificationUrl = result.verification_uri_complete ?? result.verification_uri;

        userCodeElement.textContent = result.user_code;

        verificationLink.href = result.verification_uri;

        verificationLink.textContent = result.verification_uri;

        authorizationBox.hidden = false;

        showAuthStatus("En attente de votre autorisation...");

        // Le code privé reste uniquement en mémoire.
        accessToken = await pollAuthorization(
          result.device_code,
          result.interval ?? 5,
          result.expires_in
        );

        authorizationBox.hidden = true;

        connectButton.textContent = "Compte connecté";

        showAuthStatus("Connexion à Thélyson réussie. Chargement des projets...");

        try {
          await chargerProjetsWord(accessToken);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "Erreur inconnue.";

          showAuthStatus("Compte connecté, mais impossible de charger les projets : " + message);
        }

        // Aucun jeton n'est affiché dans la console.

        // Aucun jeton n'est affiché dans la console.
      } catch (error) {
        showAuthStatus(error instanceof Error ? error.message : "Erreur de connexion à Thélyson.");

        console.error("Connexion Word / Clerk : échec");
      } finally {
        connectButton.disabled = false;
      }
    });
  }

  if (documentName) {
    documentName.textContent = getDocumentName();
  }

  if (!button) {
    return;
  }

  // Le dépôt réel n'est pas encore activé.
  button.disabled = false;
  button.textContent = "Tester la lecture du document";

  button.addEventListener("click", async () => {
    // Vérifier le mode de projet sélectionné.
    const nouveauProjet =
      document.getElementById("new-project-tab")?.getAttribute("aria-pressed") === "true";

    if (nouveauProjet) {
      const titleInput = document.getElementById("project-title") as HTMLInputElement | null;

      const title = titleInput?.value.trim() ?? "";

      if (!title) {
        if (notice) {
          notice.textContent = "Veuillez renseigner le titre du nouveau projet.";
        }
        return;
      }
    } else {
      const projectSelect = document.getElementById(
        "word-project-select"
      ) as HTMLSelectElement | null;

      if (!projectSelect?.value) {
        if (notice) {
          notice.textContent = "Veuillez sélectionner un projet existant.";
        }
        return;
      }
    }
    button.disabled = true;
    button.textContent = "Lecture en cours...";

    if (notice) {
      notice.textContent = "Lecture locale du document Word...";
    }

    try {
      const documentBytes = await readWordDocument();

      // Vérifier d'abord que le chiffrement AES local fonctionne.
      await testerChiffrementLocal(documentBytes);

      // La clé publique doit provenir du compte Thélyson connecté.
      if (!wordPublicKeyJwk) {
        throw new Error(
          "Clé publique RSA indisponible. Connectez-vous à Thélyson et vérifiez que votre clé RSA est prête."
        );
      }

      // Préparer le manuscrit avec le format cryptographique Thélyson.
      const encryptedManuscript = await preparerManuscritWord(documentBytes, wordPublicKeyJwk);

      // Vérifier les formats attendus par Thélyson Web.
      if (
        encryptedManuscript.ivBase64.length !== 16 ||
        encryptedManuscript.wrappedKeyBase64.length !== 512 ||
        !/^[a-f0-9]{64}$/.test(encryptedManuscript.fileHash) ||
        encryptedManuscript.encryptedBlob.size !== documentBytes.byteLength + 16
      ) {
        throw new Error("Le format du manuscrit chiffré est incompatible avec Thélyson.");
      }

      // Calculer le SHA-256 du document Word récupéré.
      const buffer = new ArrayBuffer(documentBytes.byteLength);

      new Uint8Array(buffer).set(documentBytes);

      const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);

      const fileHash = Array.from(new Uint8Array(hashBuffer))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");

      console.log("Thélyson - Empreinte SHA-256 :", fileHash);

      const sizeKB = (documentBytes.byteLength / 1024).toFixed(1);

      if (notice) {
        notice.textContent =
          "Document lu avec succès : " +
          " Clé AES protégée par RSA-OAEP. Format Thélyson vérifié." +
          sizeKB +
          " Ko. " +
          "Empreinte SHA-256 : " +
          fileHash.slice(0, 20) +
          "Chiffrement AES-GCM local vérifié" +
          "… Aucun fichier n'a été envoyé.";
      }

      console.log(
        "Thélyson : document Word accessible, taille :",
        documentBytes.byteLength,
        "octets"
      );
    } catch (error) {
      console.error("Thélyson : erreur de lecture Word", error);

      if (notice) {
        notice.textContent =
          error instanceof Error ? error.message : "Impossible de lire ce document.";
      }
    } finally {
      button.disabled = false;
      button.textContent = "Tester la lecture du document";
    }
  });
});
