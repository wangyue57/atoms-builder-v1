import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const compose = readFileSync(new URL("../../docker-compose.yml", import.meta.url), "utf8")
const caddy = readFileSync(new URL("../Caddyfile", import.meta.url), "utf8")
const envExample = readFileSync(new URL("../../.env.example", import.meta.url), "utf8")

function service(name: string): string {
  return compose.match(new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z]|\\nvolumes:|\\nnetworks:)`))?.[1] ?? ""
}

test("database and app host ports stay on loopback and no service receives Docker socket", () => {
  assert.match(service("postgres"), /127\.0\.0\.1:.*5432/)
  assert.match(service("api"), /127\.0\.0\.1:.*8787/)
  assert.doesNotMatch(service("worker"), /\n    ports:/)
  assert.doesNotMatch(compose, /docker\.sock/)
  assert.match(service("caddy"), /profiles: \[https\]/)
})

test("the same image runs API and durable worker against one PostgreSQL service", () => {
  assert.match(service("api"), /APP_IMAGE:-atoms-builder:local/)
  assert.match(service("worker"), /APP_IMAGE:-atoms-builder:local/)
  assert.match(service("api"), /dist\/main\.js/)
  assert.match(service("worker"), /dist\/worker\.js/)
  assert.match(compose, /@postgres:5432/)
  assert.match(service("postgres"), /postgres_data:\/var\/lib\/postgresql\/data/)
  assert.match(service("postgres"), /condition: service_healthy|pg_isready/)
})

test("optional HTTPS routes to the actual API and SPA origin", () => {
  assert.match(caddy, /reverse_proxy api:8787/)
  assert.doesNotMatch(caddy, /auto_https\s+(off|disable_redirects|disable_certs)/)
  assert.doesNotMatch(caddy, /studio:3000|control-api:4000|preview-gateway/)
})

test("example credentials are placeholders and setup creates actual local credentials", () => {
  assert.match(envExample, /POSTGRES_PASSWORD=replace-/)
  assert.match(envExample, /POSTGRES_ADMIN_PASSWORD=replace-/)
  assert.match(envExample, /TEST_DATABASE_URL=/)
  assert.doesNotMatch(envExample, /sk-[A-Za-z0-9]{20,}/)
})
