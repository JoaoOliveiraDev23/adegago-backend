// Prepara o ambiente LOCAL (emuladores do Firebase) para desenvolvimento:
//   1. cria um usuário administrador de teste no Authentication (emulador);
//   2. cria o documento admins/{uid} desse usuário (o que, no Firebase real, é feito à mão no Console);
//   3. cadastra os produtos de exemplo de seed/produtos.json (se a coleção estiver vazia).
//
// SEGURANÇA: este script só conversa com os emuladores (127.0.0.1) e usa um projeto "demo-".
// Ele NÃO consegue alterar o Firebase real. Nenhuma senha fica no código: use variáveis de ambiente.
//
// Uso (com os emuladores rodando em outro terminal: npm run emuladores):
//   Linux/macOS:  ADMIN_EMAIL=admin@teste.com ADMIN_SENHA=SUA_SENHA_DE_TESTE npm run emuladores:dados
//   PowerShell:   $env:ADMIN_EMAIL="admin@teste.com"; $env:ADMIN_SENHA="SUA_SENHA_DE_TESTE"; npm run emuladores:dados
import { readFileSync } from 'node:fs';

import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import { addDoc, collection, doc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';

const PROJECT_ID = 'demo-adegago';
const HOST = '127.0.0.1';
const PORTA_AUTH = 9099;
const PORTA_FIRESTORE = 8080;

function falhar(mensagem) {
  console.error(`\nErro: ${mensagem}\n`);
  process.exit(1);
}

const email = process.env.ADMIN_EMAIL?.trim();
const senha = process.env.ADMIN_SENHA;
if (!email || !senha) {
  falhar('defina as variáveis de ambiente ADMIN_EMAIL e ADMIN_SENHA (veja o início deste arquivo).');
}
if (senha.length < 6) falhar('a senha precisa ter pelo menos 6 caracteres.');

// Confere se os emuladores estão no ar antes de começar.
for (const [nome, porta] of [['Firestore', PORTA_FIRESTORE], ['Authentication', PORTA_AUTH]]) {
  try {
    await fetch(`http://${HOST}:${porta}`);
  } catch {
    falhar(`o emulador do ${nome} não está respondendo em ${HOST}:${porta}. Rode "npm run emuladores" em outro terminal.`);
  }
}

// 1) Usuário no Authentication (emulador)
const app = initializeApp({ apiKey: 'demo-api-key', projectId: PROJECT_ID }, 'preparar-emulador');
const auth = getAuth(app);
connectAuthEmulator(auth, `http://${HOST}:${PORTA_AUTH}`, { disableWarnings: true });

let uid;
try {
  uid = (await createUserWithEmailAndPassword(auth, email, senha)).user.uid;
  console.log(`Usuário criado no Authentication (emulador): ${email}`);
} catch (erro) {
  if (erro.code !== 'auth/email-already-in-use') throw erro;
  uid = (await signInWithEmailAndPassword(auth, email, senha)).user.uid;
  console.log(`Usuário já existia no Authentication (emulador): ${email}`);
}

// 2) admins/{uid} e 3) produtos de exemplo
const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: { host: HOST, port: PORTA_FIRESTORE },
});

try {
  // Ignora as regras só para criar o documento de admin (o app em si nunca consegue fazer isso).
  await testEnv.withSecurityRulesDisabled(async (contexto) => {
    await setDoc(doc(contexto.firestore(), 'admins', uid), { papel: 'admin', email });
  });
  console.log(`Documento admins/${uid} criado.`);

  // Os produtos são gravados como ADMINISTRADOR, então passam pelas regras de validação.
  const db = testEnv.authenticatedContext(uid).firestore();
  const existentes = await getDocs(collection(db, 'produtos'));
  if (!existentes.empty) {
    console.log(`A coleção produtos já tem ${existentes.size} documento(s). Nenhum produto de exemplo foi adicionado.`);
  } else {
    const lista = JSON.parse(readFileSync(new URL('../seed/produtos.json', import.meta.url), 'utf8'));
    // Grava do último para o primeiro: o catálogo ordena do mais novo para o mais antigo.
    for (const item of [...lista].reverse()) {
      await addDoc(collection(db, 'produtos'), {
        ...item,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    console.log(`${lista.length} produtos de exemplo cadastrados.`);
  }
} finally {
  await testEnv.cleanup();
  await deleteApp(app);
}

console.log('\nPronto. Entre no sistema com o e-mail e a senha que você definiu.');
