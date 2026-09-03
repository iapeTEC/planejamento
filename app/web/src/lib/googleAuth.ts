const GOOGLE_CLIENT_ID = "8144911742-bb0vh5uif0aurg33vtpjg5892smggahm.apps.googleusercontent.com";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: { client_id: string; callback: (resp: { credential: string }) => void }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

let scriptLoaded: Promise<void> | null = null;

function loadGoogleScript(): Promise<void> {
  if (scriptLoaded) return scriptLoaded;
  scriptLoaded = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Falha ao carregar o login do Google."));
    document.head.appendChild(script);
  });
  return scriptLoaded;
}

export async function renderGoogleSignInButton(el: HTMLElement, onSignedIn: (idToken: string) => void) {
  await loadGoogleScript();
  window.google!.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: (resp) => onSignedIn(resp.credential),
  });
  window.google!.accounts.id.renderButton(el, { theme: "outline", size: "large", text: "signin_with" });
}
