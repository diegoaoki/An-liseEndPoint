import "./globals.css";

export const metadata = {
  title: "Endpoint Monitor — Admin",
  description: "Cadastro e monitoramento de tempo de resposta de endpoints",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
