# Render API and Vercel frontend deployment notes

Signup requests use MongoDB-backed rate limits shared across instances: 5 registration requests per IP per 15-minute window, 2 per normalized email per 15-minute window, and 50 across the application per one-hour window.

## Cloudflare Turnstile

1. In Cloudflare, open **Turnstile**, create a widget for the production frontend hostname(s), and choose the managed widget mode. Include the Vercel production domain and any custom domain used by the frontend. Do not register the Render API hostname; Turnstile runs on the browser page.
2. Copy the **site key** into Vercel's frontend project environment as `VITE_TURNSTILE_SITE_KEY`, for the Production environment (and Preview only if you register preview hostnames). Redeploy the frontend after changing it. This key is public and is expected in the browser.
3. Copy the **secret key** into the Render API service environment as `TURNSTILE_SECRET_KEY`. Never put the secret in a `VITE_` variable, the frontend, or a committed file.
4. Set `TURNSTILE_ALLOWED_HOSTNAMES` on Render to the exact frontend hostnames registered in Cloudflare, comma-separated and without `https://` or paths, for example `zavique-art.vercel.app,www.example.com`. Add each Preview hostname only if Preview signup should work.
5. Set `CORS_ORIGINS` on Render to the frontend origin(s), including scheme, for example `https://zavique-art.vercel.app,https://www.example.com`. This is separate from the Turnstile hostname list.
6. After deployment, open the Vercel frontend registration page: the widget must load and block submission until a token is issued. Confirm a valid challenge succeeds, then send a signup request without `captchaToken` to the Render API and confirm it is rejected.

The API verifies each token with Cloudflare Siteverify, checks the expected `signup` action and the verified hostname, and rejects unavailable verification in production. Local development can leave the keys unset; set a Cloudflare test widget site/secret pair locally if you want to exercise the complete challenge flow.

## Render email queue and required API settings

Set the environment variables in `.env.example` on Render, including a random `CRON_SECRET` of at least 32 characters, a base64-encoded 32-byte `EMAIL_QUEUE_ENCRYPTION_KEY`, SMTP credentials, a valid `JWT_SECRET`, and `TRUST_PROXY_HOPS=1` for the Render proxy. Keep `MONGODB_URI` reachable by both the API and the worker.

For this hosting layout, create a Render **Background Worker** using the same repository and backend root directory, with start command `npm run worker:signup-email`. Copy the backend environment variables it needs (`MONGODB_URI`, `EMAIL_USER`, `EMAIL_PASS`, and `EMAIL_QUEUE_ENCRYPTION_KEY`). The Vercel Cron declaration in `vercel.json` is only useful when the backend itself is deployed on Vercel; it does not run a worker hosted on Render.

## Local development email

In development (`NODE_ENV=development`), signup sends the OTP directly through SMTP after saving the pending registration. It does not need the email worker. Create `Backend/.env` from `.env.example`, configure `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_SECURE`, `EMAIL_USER`, and `EMAIL_PASS`, then restart the backend with `npm run dev`. The defaults target Gmail SMTP (`smtp.gmail.com`, port `587`, TLS via STARTTLS); for Gmail, enable 2-Step Verification and use a Google App Password, not your normal account password. Keep `.env` private and do not commit it.

If SMTP is not configured or delivery fails, the signup API returns an error instead of falsely claiming the OTP was sent. Check the backend terminal logs and spam folder. Production continues to queue OTP emails for the configured background worker.

`DISPOSABLE_EMAIL_DOMAINS` accepts a comma-separated operator-maintained denylist. It is a basic filter, not a substitute for a maintained disposable-address reputation service. Configure log-based alerts for `signup_budget_limited`, `auth_rate_limited`, `signup_captcha_rejected`, and email delivery failures in the hosting provider.
