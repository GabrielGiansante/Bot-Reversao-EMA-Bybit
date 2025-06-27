// =================================================================
// SCRIPT DE DIAGNÓSTICO: LISTAR SÍMBOLOS VÁLIDOS
// =================================================================

const { RestClientV5 } = require('bybit-api');

// --- Suas Configurações ---
const API_KEY = process.env.API_KEY;
const API_SECRET = process.env.API_SECRET;
const CATEGORY = 'linear'; // A categoria que estamos investigando

const client = new RestClientV5({ key: API_KEY, secret: API_SECRET });

async function discoverSymbols() {
  console.log(`\nBuscando instrumentos para a categoria: "${CATEGORY}"...`);

  try {
    const response = await client.getInstrumentsInfo({
      category: CATEGORY,
    });

    if (response.retCode === 0 && response.result.list) {
      console.log(`\nSUCESSO! ${response.result.list.length} símbolos encontrados.`);
      console.log("=================================================");

      // Filtra para mostrar apenas os que envolvem BTC
      const btcSymbols = response.result.list.filter(item => item.baseCoin === 'BTC');

      if (btcSymbols.length > 0) {
        console.log("Símbolos de BTC encontrados nesta categoria:\n");
        btcSymbols.forEach(symbolInfo => {
          console.log(` -> Símbolo: ${symbolInfo.symbol}`);
          console.log(`    Moeda de Margem: ${symbolInfo.settleCoin}`);
          console.log(`    Status: ${symbolInfo.status}`);
          console.log(`    Quantidade Mínima: ${symbolInfo.lotSizeFilter.minOrderQty}`);
          console.log("--------------------");
        });
      } else {
        console.log("Nenhum símbolo de BTC encontrado nesta categoria.");
      }

    } else {
      console.error("ERRO DA API AO BUSCAR INSTRUMENTOS:", JSON.stringify(response));
    }
  } catch (error) {
    console.error("ERRO CRÍTICO NA CHAMADA DE getInstrumentsInfo:", error);
  }
}

// Executa a função de diagnóstico
discoverSymbols();