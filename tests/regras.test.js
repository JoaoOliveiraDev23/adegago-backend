// Testes das Security Rules do Firestore (firestore.rules).
//
// Estes testes falam DIRETO com o emulador do Firestore, então verificam as regras de verdade
// (e não apenas o comportamento visual do frontend).
//
// Como executar (o emulador é iniciado e encerrado automaticamente):
//   npm test
//
// Requisitos: Node 20.19+ e Java JDK 21+ (usado pelo emulador do Firestore).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, it } from 'node:test';

import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

const PROJECT_ID = 'demo-adegago';
const ADMIN_UID = 'uid-do-administrador';
const COMUM_UID = 'uid-de-usuario-comum';
const DATA_ANTIGA = Timestamp.fromDate(new Date('2026-01-01T12:00:00Z'));

let testEnv;

function enderecoDoEmulador() {
  // `firebase emulators:exec` define FIRESTORE_EMULATOR_HOST (ex.: 127.0.0.1:8080).
  const [host, porta] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
  return { host, port: Number(porta) };
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
      ...enderecoDoEmulador(),
    },
  });
});

after(async () => {
  await testEnv?.cleanup();
});

// Estado inicial de CADA teste: banco limpo, um administrador e dois produtos.
beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (contexto) => {
    const db = contexto.firestore();
    // Equivale ao documento criado manualmente no Console: admins/{uid}
    await setDoc(doc(db, 'admins', ADMIN_UID), { papel: 'admin' });
    await setDoc(doc(db, 'produtos', 'existente'), {
      nome: 'Vinho Tinto Malbec 750 ml',
      descricao: 'Tinto de corpo médio.',
      categoria: 'Vinhos e espumantes',
      preco: 69.9,
      disponivel: true,
      createdAt: DATA_ANTIGA,
      updatedAt: DATA_ANTIGA,
    });
    await setDoc(doc(db, 'produtos', 'em-promocao'), {
      nome: 'Cerveja IPA Artesanal 500 ml',
      descricao: 'Amargor marcante.',
      categoria: 'Cervejas',
      preco: 24.9,
      precoPromocional: 19.9,
      disponivel: true,
      createdAt: DATA_ANTIGA,
      updatedAt: DATA_ANTIGA,
    });
  });
});

// ---------------------------------------------------------------
// Ajudantes
// ---------------------------------------------------------------
const visitante = () => testEnv.unauthenticatedContext().firestore();
const usuarioComum = () => testEnv.authenticatedContext(COMUM_UID).firestore();
const administrador = () => testEnv.authenticatedContext(ADMIN_UID).firestore();

const produtos = (db) => collection(db, 'produtos');
const produto = (db, id) => doc(db, 'produtos', id);

// Produto válido para CRIAÇÃO (datas geradas pelo servidor, como faz o frontend).
function novoProduto(alteracoes = {}) {
  return {
    nome: 'Cerveja Pilsen Long Neck 355 ml',
    descricao: 'Cerveja leve e refrescante.',
    categoria: 'Cervejas',
    preco: 6.5,
    disponivel: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...alteracoes,
  };
}

function sem(objeto, campo) {
  const copia = { ...objeto };
  delete copia[campo];
  return copia;
}

// ---------------------------------------------------------------
// 1. Consulta pública
// ---------------------------------------------------------------
describe('Consulta pública dos produtos', () => {
  it('visitante sem login consegue listar os produtos', async () => {
    const resultado = await assertSucceeds(getDocs(produtos(visitante())));
    assert.equal(resultado.size, 2);
  });

  it('visitante sem login consegue ler um produto', async () => {
    const resultado = await assertSucceeds(getDoc(produto(visitante(), 'existente')));
    assert.equal(resultado.data().nome, 'Vinho Tinto Malbec 750 ml');
  });

  it('usuário logado comum também consegue ler produtos', async () => {
    await assertSucceeds(getDocs(produtos(usuarioComum())));
  });

  it('produto inexistente: a leitura é permitida e retorna "não existe"', async () => {
    const resultado = await assertSucceeds(getDoc(produto(visitante(), 'nao-existe')));
    assert.equal(resultado.exists(), false);
  });
});

// ---------------------------------------------------------------
// 2. Escrita sem permissão
// ---------------------------------------------------------------
describe('Escrita sem permissão administrativa', () => {
  it('visitante sem login NÃO cria produto', async () => {
    await assertFails(addDoc(produtos(visitante()), novoProduto()));
  });

  it('visitante sem login NÃO edita produto', async () => {
    await assertFails(
      updateDoc(produto(visitante(), 'existente'), { disponivel: false, updatedAt: serverTimestamp() }),
    );
  });

  it('visitante sem login NÃO exclui produto', async () => {
    await assertFails(deleteDoc(produto(visitante(), 'existente')));
  });

  it('usuário logado SEM documento em admins NÃO cria produto', async () => {
    await assertFails(addDoc(produtos(usuarioComum()), novoProduto()));
  });

  it('usuário logado SEM documento em admins NÃO edita produto', async () => {
    await assertFails(
      updateDoc(produto(usuarioComum(), 'existente'), { disponivel: false, updatedAt: serverTimestamp() }),
    );
  });

  it('usuário logado SEM documento em admins NÃO exclui produto', async () => {
    await assertFails(deleteDoc(produto(usuarioComum(), 'existente')));
  });

  it('as tentativas negadas não alteram os dados', async () => {
    await assertFails(deleteDoc(produto(usuarioComum(), 'existente')));
    const resultado = await assertSucceeds(getDoc(produto(visitante(), 'existente')));
    assert.equal(resultado.exists(), true);
  });
});

// ---------------------------------------------------------------
// 3. Administrador autorizado
// ---------------------------------------------------------------
describe('Administrador autorizado', () => {
  it('cria produto válido (só campos obrigatórios)', async () => {
    await assertSucceeds(addDoc(produtos(administrador()), novoProduto()));
  });

  it('cria produto com promoção e imagem', async () => {
    await assertSucceeds(
      addDoc(
        produtos(administrador()),
        novoProduto({ preco: 24.9, precoPromocional: 19.9, imagem: '/imagens/cerveja-ipa.svg' }),
      ),
    );
  });

  it('cria produto indisponível', async () => {
    await assertSucceeds(addDoc(produtos(administrador()), novoProduto({ disponivel: false })));
  });

  it('edita o produto completo', async () => {
    await assertSucceeds(
      updateDoc(produto(administrador(), 'existente'), {
        nome: 'Vinho Tinto Malbec Reserva 750 ml',
        preco: 79.9,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('altera apenas a disponibilidade', async () => {
    await assertSucceeds(
      updateDoc(produto(administrador(), 'existente'), { disponivel: false, updatedAt: serverTimestamp() }),
    );
    const resultado = await getDoc(produto(administrador(), 'existente'));
    assert.equal(resultado.data().disponivel, false);
  });

  it('atualiza preço e configura promoção', async () => {
    await assertSucceeds(
      updateDoc(produto(administrador(), 'existente'), {
        preco: 70,
        precoPromocional: 59.9,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('remove a promoção (deleteField)', async () => {
    await assertSucceeds(
      updateDoc(produto(administrador(), 'em-promocao'), {
        precoPromocional: deleteField(),
        updatedAt: serverTimestamp(),
      }),
    );
    const resultado = await getDoc(produto(administrador(), 'em-promocao'));
    assert.equal('precoPromocional' in resultado.data(), false);
  });

  it('exclui produto', async () => {
    await assertSucceeds(deleteDoc(produto(administrador(), 'existente')));
    const resultado = await getDoc(produto(visitante(), 'existente'));
    assert.equal(resultado.exists(), false);
  });
});

// ---------------------------------------------------------------
// 4. Campos obrigatórios e inesperados
// ---------------------------------------------------------------
describe('Campos obrigatórios e inesperados', () => {
  for (const campo of ['nome', 'descricao', 'categoria', 'preco', 'disponivel', 'createdAt', 'updatedAt']) {
    it(`rejeita produto sem o campo obrigatório "${campo}"`, async () => {
      await assertFails(addDoc(produtos(administrador()), sem(novoProduto(), campo)));
    });
  }

  it('rejeita campo inesperado (estoque)', async () => {
    await assertFails(addDoc(produtos(administrador()), novoProduto({ estoque: 10 })));
  });

  it('rejeita o campo "emPromocao" (deve ser derivado de precoPromocional)', async () => {
    await assertFails(addDoc(produtos(administrador()), novoProduto({ emPromocao: true })));
  });

  it('rejeita campo inesperado também na edição', async () => {
    await assertFails(
      updateDoc(produto(administrador(), 'existente'), { estoque: 5, updatedAt: serverTimestamp() }),
    );
  });
});

// ---------------------------------------------------------------
// 5. Tipos e valores
// ---------------------------------------------------------------
describe('Validação de tipos e valores', () => {
  const invalidos = [
    ['nome numérico', { nome: 123 }],
    ['nome vazio', { nome: '' }],
    ['nome com 1 caractere', { nome: 'A' }],
    ['nome com mais de 80 caracteres', { nome: 'x'.repeat(81) }],
    ['descrição vazia', { descricao: '' }],
    ['descrição com mais de 240 caracteres', { descricao: 'x'.repeat(241) }],
    ['categoria numérica', { categoria: 5 }],
    ['categoria com 1 caractere', { categoria: 'C' }],
    ['disponibilidade como texto', { disponivel: 'sim' }],
    ['disponibilidade numérica', { disponivel: 1 }],
  ];
  for (const [descricao, alteracao] of invalidos) {
    it(`rejeita ${descricao}`, async () => {
      await assertFails(addDoc(produtos(administrador()), novoProduto(alteracao)));
    });
  }

  it('aceita nome com exatamente 80 caracteres', async () => {
    await assertSucceeds(addDoc(produtos(administrador()), novoProduto({ nome: 'x'.repeat(80) })));
  });
});

describe('Validação de preços', () => {
  const invalidos = [
    ['preço negativo', -1],
    ['preço zero', 0],
    ['preço como texto', '10,50'],
    ['preço nulo', null],
    ['preço com 3 casas decimais', 10.999],
    ['preço acima de R$ 99.999,99', 100000],
  ];
  for (const [descricao, preco] of invalidos) {
    it(`rejeita ${descricao}`, async () => {
      await assertFails(addDoc(produtos(administrador()), novoProduto({ preco })));
    });
  }

  const validos = [
    ['preço inteiro', 10],
    ['preço com 1 casa decimal', 24.9],
    ['preço com 2 casas decimais', 19.99],
    ['preço mínimo (R$ 0,01)', 0.01],
    ['preço máximo (R$ 99.999,99)', 99999.99],
  ];
  for (const [descricao, preco] of validos) {
    it(`aceita ${descricao}`, async () => {
      await assertSucceeds(addDoc(produtos(administrador()), novoProduto({ preco })));
    });
  }

  it('rejeita preço negativo na edição', async () => {
    await assertFails(
      updateDoc(produto(administrador(), 'existente'), { preco: -5, updatedAt: serverTimestamp() }),
    );
  });
});

describe('Validação de promoções', () => {
  const invalidos = [
    ['promocional igual ao preço normal', 10, 10],
    ['promocional maior que o preço normal', 10, 12],
    ['promocional negativo', 10, -2],
    ['promocional zero', 10, 0],
    ['promocional como texto', 10, '5,00'],
    ['promocional nulo', 10, null],
    ['promocional com 3 casas decimais', 10, 5.555],
  ];
  for (const [descricao, preco, precoPromocional] of invalidos) {
    it(`rejeita ${descricao}`, async () => {
      await assertFails(addDoc(produtos(administrador()), novoProduto({ preco, precoPromocional })));
    });
  }

  it('aceita promocional menor que o preço normal', async () => {
    await assertSucceeds(
      addDoc(produtos(administrador()), novoProduto({ preco: 10, precoPromocional: 9.99 })),
    );
  });

  it('rejeita reduzir o preço normal abaixo do promocional existente', async () => {
    // em-promocao: preço 24,90 / promocional 19,90
    await assertFails(
      updateDoc(produto(administrador(), 'em-promocao'), { preco: 15, updatedAt: serverTimestamp() }),
    );
  });

  it('rejeita promocional maior ou igual ao preço na edição', async () => {
    await assertFails(
      updateDoc(produto(administrador(), 'existente'), {
        precoPromocional: 80,
        updatedAt: serverTimestamp(),
      }),
    );
  });
});

describe('Validação da imagem', () => {
  it('aceita endereço https://', async () => {
    await assertSucceeds(
      addDoc(produtos(administrador()), novoProduto({ imagem: 'https://exemplo.com/foto.jpg' })),
    );
  });

  it('aceita caminho iniciado por "/"', async () => {
    await assertSucceeds(
      addDoc(produtos(administrador()), novoProduto({ imagem: '/imagens/gin.svg' })),
    );
  });

  const invalidas = [
    ['esquema javascript:', 'javascript:alert(1)'],
    ['texto sem endereço', 'foto-da-cerveja'],
    ['endereço com espaço', 'https://exemplo.com/minha foto.jpg'],
    ['valor numérico', 123],
    ['endereço com mais de 500 caracteres', `https://exemplo.com/${'a'.repeat(500)}`],
  ];
  for (const [descricao, imagem] of invalidas) {
    it(`rejeita imagem com ${descricao}`, async () => {
      await assertFails(addDoc(produtos(administrador()), novoProduto({ imagem })));
    });
  }
});

// ---------------------------------------------------------------
// 6. Datas (createdAt / updatedAt)
// ---------------------------------------------------------------
describe('Datas controladas pelo servidor', () => {
  it('rejeita criação com createdAt enviado pelo cliente', async () => {
    await assertFails(
      addDoc(produtos(administrador()), novoProduto({ createdAt: Timestamp.fromDate(new Date('2020-01-01')) })),
    );
  });

  it('rejeita criação com updatedAt enviado pelo cliente', async () => {
    await assertFails(
      addDoc(produtos(administrador()), novoProduto({ updatedAt: Timestamp.fromDate(new Date('2020-01-01')) })),
    );
  });

  it('rejeita criação com data em formato de texto', async () => {
    await assertFails(addDoc(produtos(administrador()), novoProduto({ createdAt: '2026-01-01' })));
  });

  it('rejeita edição que não renova o updatedAt', async () => {
    await assertFails(updateDoc(produto(administrador(), 'existente'), { disponivel: false }));
  });

  it('rejeita edição com updatedAt antigo enviado pelo cliente', async () => {
    await assertFails(
      updateDoc(produto(administrador(), 'existente'), { disponivel: false, updatedAt: DATA_ANTIGA }),
    );
  });

  it('rejeita edição que altera o createdAt', async () => {
    await assertFails(
      updateDoc(produto(administrador(), 'existente'), {
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });
});

// ---------------------------------------------------------------
// 7. Documentos administrativos e permissões
// ---------------------------------------------------------------
describe('Proteção dos documentos administrativos (admins)', () => {
  it('administrador consegue ler o PRÓPRIO documento (para o app saber que é admin)', async () => {
    const resultado = await assertSucceeds(getDoc(doc(administrador(), 'admins', ADMIN_UID)));
    assert.equal(resultado.exists(), true);
  });

  it('usuário comum lê o próprio documento e vê que NÃO existe (não é admin)', async () => {
    const resultado = await assertSucceeds(getDoc(doc(usuarioComum(), 'admins', COMUM_UID)));
    assert.equal(resultado.exists(), false);
  });

  it('usuário comum NÃO lê o documento de outro usuário (nem do admin)', async () => {
    await assertFails(getDoc(doc(usuarioComum(), 'admins', ADMIN_UID)));
  });

  it('visitante sem login NÃO lê documentos de admins', async () => {
    await assertFails(getDoc(doc(visitante(), 'admins', ADMIN_UID)));
  });

  it('ninguém lista a coleção admins (nem o administrador)', async () => {
    await assertFails(getDocs(collection(visitante(), 'admins')));
    await assertFails(getDocs(collection(usuarioComum(), 'admins')));
    await assertFails(getDocs(collection(administrador(), 'admins')));
  });

  it('usuário comum NÃO consegue se tornar admin (auto-promoção)', async () => {
    await assertFails(setDoc(doc(usuarioComum(), 'admins', COMUM_UID), { papel: 'admin' }));
  });

  it('depois da tentativa de auto-promoção, o usuário continua sem poder escrever produtos', async () => {
    await assertFails(setDoc(doc(usuarioComum(), 'admins', COMUM_UID), { papel: 'admin' }));
    await assertFails(addDoc(produtos(usuarioComum()), novoProduto()));
  });

  it('visitante sem login NÃO cria documento de admin', async () => {
    await assertFails(setDoc(doc(visitante(), 'admins', 'qualquer'), { papel: 'admin' }));
  });

  it('nem o administrador cria outro administrador pelo app', async () => {
    await assertFails(setDoc(doc(administrador(), 'admins', COMUM_UID), { papel: 'admin' }));
  });

  it('nem o administrador altera o próprio documento de admin', async () => {
    await assertFails(updateDoc(doc(administrador(), 'admins', ADMIN_UID), { papel: 'outro' }));
  });

  it('nem o administrador exclui o próprio documento de admin', async () => {
    await assertFails(deleteDoc(doc(administrador(), 'admins', ADMIN_UID)));
  });
});

describe('Coleções não previstas', () => {
  it('leitura e escrita em coleção desconhecida são negadas (mesmo para admin)', async () => {
    await assertFails(getDocs(collection(visitante(), 'pedidos')));
    await assertFails(addDoc(collection(administrador(), 'pedidos'), { qualquer: 'coisa' }));
    await assertFails(setDoc(doc(administrador(), 'configuracoes', 'geral'), { qualquer: 'coisa' }));
  });
});
