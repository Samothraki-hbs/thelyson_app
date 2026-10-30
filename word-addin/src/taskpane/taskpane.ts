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

  let accessToken: string | null = null;

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

  // Premier dépôt réel depuis Word.
  // Limité aux projets existants non partagés.
  button.disabled = false;
  button.textContent = "Déposer le manuscrit chiffré (test)";

  button.addEventListener("click", async () => {
    const token = accessToken;
    const publicKeyJwk = wordPublicKeyJwk;

    if (!token) {
      if (notice) {
        notice.textContent = "Connectez-vous d'abord à votre compte Thélyson.";
      }
      return;
    }

    if (!publicKeyJwk) {
      if (notice) {
        notice.textContent = "Votre clé publique RSA n'est pas prête.";
      }
      return;
    }

    // Pour ce premier essai, un projet existant est requis.
    const modeExistant =
      document.getElementById("existing-project-tab")?.getAttribute("aria-pressed") === "true";

    if (!modeExistant) {
      if (notice) {
        notice.textContent =
          "Pour ce premier dépôt, choisissez " + "un projet existant non partagé.";
      }
      return;
    }

    const projectSelect = document.getElementById(
      "word-project-select"
    ) as HTMLSelectElement | null;

    const projectId = projectSelect?.value ?? "";

    if (!projectId) {
      if (notice) {
        notice.textContent = "Sélectionnez d'abord un projet Thélyson.";
      }
      return;
    }

    const fileName = getDocumentName();

    if (!/\.docx$/i.test(fileName) || fileName.length > 255 || /[\\/]/.test(fileName)) {
      if (notice) {
        notice.textContent =
          "Enregistrez d'abord votre document Word " + "avec un nom de fichier .docx valide.";
      }
      return;
    }

    button.disabled = true;
    button.textContent = "Dépôt en cours...";

    try {
      if (notice) {
        notice.textContent = "Lecture et chiffrement local du manuscrit...";
      }

      // 1. Lire le document Word ouvert.
      const documentBytes = await readWordDocument();

      // 2. Préparer le chiffrement AES-GCM + RSA-OAEP.
      const encryptedManuscript = await preparerManuscritWord(documentBytes, publicKeyJwk);

      // 3. Vérifier le format cryptographique.
      if (
        encryptedManuscript.ivBase64.length !== 16 ||
        encryptedManuscript.wrappedKeyBase64.length !== 512 ||
        !/^[a-f0-9]{64}$/.test(encryptedManuscript.fileHash) ||
        encryptedManuscript.encryptedBlob.size !== documentBytes.byteLength + 16
      ) {
        throw new Error("Le format du manuscrit chiffré est invalide.");
      }

      // 4. Construire le formulaire envoyé au serveur.
      // Aucun octet du DOCX original n'est inclus.
      const form = new FormData();

      form.append("projectId", projectId);
      form.append("fileName", fileName);
      form.append("fileHash", encryptedManuscript.fileHash);
      form.append("ivBase64", encryptedManuscript.ivBase64);
      form.append("wrappedKeyBase64", encryptedManuscript.wrappedKeyBase64);
      form.append("encryptedFile", encryptedManuscript.encryptedBlob, "manuscrit.enc");

      if (notice) {
        notice.textContent = "Envoi du manuscrit chiffré vers Thélyson...";
      }

      // 5. Appeler l'API Word authentifiée.
      const response = await fetch("https://localhost:3001/api/word/upload", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: form,
      });

      // Le navigateur définit lui-même le Content-Type
      // multipart/form-data et sa boundary.

      const result = (await response.json()) as {
        success?: boolean;
        versionId?: string;
        storagePath?: string;

        // Résultat de la certification Polygon Amoy.
        blockchainSubmitted?: boolean;
        blockchainStatus?: "submitted" | "unconfirmed";
        blockchainTxId?: string;
        blockchainWarning?: string;

        error?: string;
        requiresReview?: boolean;
      };

      if (!response.ok || !result.success || !result.versionId) {
        const message = result.error ?? `Le serveur a répondu HTTP ${response.status}.`;

        throw new Error(
          result.requiresReview
            ? message + " Ne relancez pas le dépôt avant vérification."
            : message
        );
      }

      // 6. Afficher le résultat réel du dépôt et de la blockchain.
      if (notice) {
        const versionMessage =
          "Manuscrit chiffré enregistré dans Thélyson. " + "Version : " + result.versionId + ". ";

        if (
          result.blockchainStatus === "submitted" &&
          result.blockchainTxId &&
          /^0x[a-fA-F0-9]{64}$/.test(result.blockchainTxId)
        ) {
          notice.textContent =
            versionMessage +
            "Transaction Polygon Amoy transmise. " +
            "Identifiant : " +
            result.blockchainTxId +
            ". Confirmation dans un bloc encore à vérifier.";
        } else {
          notice.textContent =
            versionMessage +
            "Ancrage blockchain non confirmé. " +
            "Ne redéposez pas le manuscrit avant vérification." +
            (result.blockchainWarning ? " Détail : " + result.blockchainWarning : "");
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Erreur inconnue lors du dépôt.";

      if (notice) {
        notice.textContent =
          message +
          " Si la demande de dépôt a déjà été envoyée, " +
          "vérifiez d'abord votre projet sur Thélyson Web " +
          "avant de recommencer.";
      }

      console.error("Thélyson Word : échec du dépôt chiffré", message);
    } finally {
      button.disabled = false;
      button.textContent = "Déposer le manuscrit chiffré (test)";
    }
  });
});
