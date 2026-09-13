import {
  powMessage,
  satisfiesProofOfWork,
} from "../../shared/proof-of-work.js";
import { element, input, field, button } from "./dom.js";

async function proof(api, progress) {
  const challenge = await api.request("/api/v1/challenge");
  const encoder = new TextEncoder();
  const deadline = Math.min(
    challenge.expiresAt ?? Date.now() + 60000,
    Date.now() + 60000,
  );
  for (let nonce = 0; nonce < 64 * 1024 * 1024; nonce++) {
    const bytes = await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(powMessage(challenge.challengeId, String(nonce))),
    );
    if (satisfiesProofOfWork(new Uint8Array(bytes), challenge.bits)) {
      return {
        challengeId: challenge.challengeId,
        nonce: String(nonce),
        csrfToken: challenge.loginToken,
      };
    }
    if (nonce % 512 === 0) {
      if (Date.now() >= deadline) {
        throw new Error("Sign-in challenge expired. Please retry.");
      }
      progress.textContent = "Verifying sign-in…";
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    }
  }
  throw new Error("Sign-in challenge exceeded its work limit");
}

export function loginScreen(api, ready) {
  let name = "",
    password = "";
  const notice = element("p", { class: "auth-notice", role: "status" });
  const submit = button("Sign in to Studio", () => {}, "button primary");
  submit.type = "submit";
  const onsubmit = async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    try {
      const solved = await proof(api, notice);
      await api.request(
        "/api/v1/session",
        api.json({ name, password, ...solved }),
      );
      password = "";
      await api.bootstrap();
      await ready();
    } catch (error) {
      notice.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  };
  const credentials = [
    field(
      "Account name",
      input(
        name,
        (value) => {
          name = value;
        },
        { name: "username", autoComplete: "username", required: true },
      ),
    ),
    field(
      "Password",
      input(
        password,
        (value) => {
          password = value;
        },
        {
          name: "password",
          type: "password",
          autoComplete: "current-password",
          required: true,
        },
      ),
    ),
  ];
  return loginLayout(
    { onsubmit, credentials, submit, notice },
    api.settings.clientUrl,
  );
}

function loginLayout({ onsubmit, credentials, submit, notice }, clientUrl) {
  const form = element("form", { class: "login-card", onsubmit }, [
    element("div", { class: "brand-mark", text: "✦" }),
    element("p", { class: "eyebrow", text: "OPENMS STUDIO" }),
    element("h1", { text: "Your next world\nstarts here." }),
    element("p", {
      text: "Build maps, bring creatures to life, and write the next adventure.",
    }),
    ...credentials,
    submit,
    notice,
    element("a", { href: clientUrl, text: "← Back to the game" }),
  ]);
  return element("main", { class: "login-page" }, [form]);
}
