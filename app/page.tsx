import { FinanceApp } from "./finance-app";

export default function Home() {
  const name = process.env.NEXT_PUBLIC_DEMO_USER_NAME?.trim() || "Tiago";
  const email = process.env.NEXT_PUBLIC_DEMO_USER_EMAIL?.trim() || "modo@demonstracao.pt";

  return <FinanceApp viewer={{ name, email }} />;
}
