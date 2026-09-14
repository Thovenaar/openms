# Quick Start

On macOS with [Homebrew](https://brew.sh/):

```sh
# Install Bun, Podman, Compose and Git.
brew install oven-sh/bun/bun podman docker-compose git

# Create and start the Podman machine; skip init if it already exists.
podman machine init
podman machine start

# Clone the repository and install dependencies.
git clone https://github.com/tensorfish/openms.git
cd openms
bun install --frozen-lockfile

# Download and unpack the original assets beside the repository.
curl --fail --location --output ../Maplestory-Assets.zip \
  http://bucket.openms.dev/Maplestory-Assets.zip
unzip -n ../Maplestory-Assets.zip -d .. -x '__MACOSX/*'

# Generate client/public/generated/ and wait for "Extraction succeeded".
bun extract --assets ../Maplestory-Client

# Start PostgreSQL and apply the database schema.
podman compose -f infra/compose.yaml up -d --build --wait --wait-timeout 90
bun run migrate --database-url postgres://openms:openms_local_only@127.0.0.1:55432/openms

# Terminal 1: start the server and wait for "authoritative server ready".
# Leave this running, then open a second terminal.
bun run server:dev

# Terminal 2: enter the same repository root and start the client.
bun run client:dev

# Open http://127.0.0.1:3102 in your browser.
# Sign in with admin / password or player / password, then select a character.
```

For other platforms, install [Bun](https://bun.sh/docs/installation), [Podman](https://podman.io/docs/installation) and a [Compose provider](https://docs.podman.io/en/latest/markdown/podman-compose.1.html); keep Git, `curl` and `unzip` available, then continue from checkout.

## Components

| Component | What it does                                                                                                                                                      |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bun       | Installs dependencies and runs the tools, server and client development listener.                                                                                 |
| Assets    | The ZIP unpacks original WZ files into `../Maplestory-Client/`. Extraction converts them and the repository gameplay definitions into `client/public/generated/`. |
| Podman    | Runs PostgreSQL and retains its data in a persistent volume.                                                                                                      |
| Migrate   | Applies `infra/sql/*.sql` and records history in PostgreSQL's `migrations` table. Server startup only checks the schema.                                          |
| Server    | Owns gameplay and saved state on port **3200**, using `.env.server`.                                                                                              |
| Client    | Serves the game and assets on port **3102**, proxies requests to the server, and uses `.env.client`.                                                              |

Next: [Custom content](custom-content.md). For settings, troubleshooting and production, see [Development](development.md).
