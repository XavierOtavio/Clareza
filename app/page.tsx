import { headers } from "next/headers";
import { FinanceApp } from "./finance-app";

export const dynamic = "force-dynamic";

export default async function Home() {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedName = requestHeaders.get("oai-authenticated-user-full-name");
  const name =
    encodedName && requestHeaders.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8"
      ? decodeURIComponent(encodedName)
      : null;

  return <FinanceApp viewer={{ name: name ?? "Tiago", email: email ?? "modo@demonstracao.pt" }} />;
}
