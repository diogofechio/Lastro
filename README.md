# Lastro.app

Aplicativo desktop para registrar saldos, acompanhar rendimentos e organizar uma carteira de investimentos. A interface também pode ser aberta no navegador pelo servidor local.

> **Privacidade:** os dados da carteira ficam em um banco SQLite no computador. O banco, os backups e as exportações pessoais não devem ser enviados ao GitHub. Uma instalação nova começa com uma carteira vazia.

## Baixar para Windows

Baixe **Lastro.app Setup 1.0.1.exe** na seção **Releases** deste repositório, execute o instalador e escolha a pasta de instalação. O instalador cria atalhos no Menu Iniciar e, opcionalmente, na Área de Trabalho.

## Recursos

- Registro de saldos e histórico de aplicações, aportes, resgates, juros, dividendos, taxas e impostos.
- Visão da carteira por instituição, tipo de ativo e liquidez, com alertas de vencimento e saldos desatualizados.
- Planejamento de juros e dividendos e simulação com taxas e contribuições informadas pelo usuário.
- Backup e restauração de saldos, movimentações, ativos, agenda e série de IPCA guardada localmente.
- Visão rápida em janela compacta no aplicativo Windows.
- Atualização do IPCA sob demanda, com conexão à internet. A estimativa de retorno real usa uma aproximação proporcional aos dias, pois o indicador é mensal.

As projeções dependem dos valores informados e não representam promessa de rentabilidade.

## Como usar o instalador

1. Baixe o instalador na página **Releases**.
2. Abra o arquivo `.exe` e siga as etapas de instalação.
3. Inicie **Lastro.app** pelo atalho criado.

Os dados da versão Electron são armazenados na pasta privada de dados do usuário do Windows. Remover o aplicativo pode ou não remover essa pasta, conforme a opção escolhida no desinstalador; mantenha backups próprios.

## Executar pelo código-fonte

Requisitos: Windows e Node.js compatível com `node:sqlite` (Node.js 22.5 ou superior recomendado).

```powershell
npm install
npm start
```

Para abrir apenas a versão web local:

```powershell
npm run start:web
```

Depois acesse `http://localhost:3000`. O servidor web salva os dados em `data/rendimentos.db`; esse arquivo é local e ignorado pelo Git.

Scripts auxiliares do Windows estão em `scripts/windows/`. Os fontes ficam em `desktop/`, `public/` e `server.js`.

## Gerar o instalador Windows

```powershell
npm install
npm run dist
```

O instalador NSIS e os arquivos auxiliares são gerados em `dist/`. Para publicar a versão 1.0.1, crie a tag `v1.0.1` no GitHub e anexe somente `dist/Lastro.app Setup 1.0.1.exe` à **GitHub Release**. Não adicione o instalador ao histórico Git, pois ele tem mais de 100 MB. O código-fonte e o `package-lock.json` permitem reproduzir a build.

## Estrutura

- `desktop/`: janela Electron, processo principal e ponte segura com a interface.
- `public/`: interface, estilos, ícones necessários, manifesto PWA, service worker e três logos SVG usados pela interface.
- `scripts/windows/`: atalhos e utilitários de inicialização para Windows.
- `scripts/tests/`: scripts de verificação usados durante o desenvolvimento.
- `server.js`: servidor local e acesso ao banco SQLite.
- `data/`: destino local do banco da versão web; dados SQLite não são versionados.

## Privacidade e segurança

O aplicativo não envia a carteira a um serviço remoto. A consulta do IPCA acessa a internet apenas quando solicitada. Não publique bancos SQLite, arquivos de backup, credenciais, logs pessoais ou informações financeiras em issues, commits ou releases.

## Licença

MIT. Consulte `LICENSE`.
