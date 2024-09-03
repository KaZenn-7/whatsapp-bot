const fs = require("fs-extra");
const util = require("util");
const moment = require("moment-timezone");
const colors = require("colors");
const { Boom } = require("@hapi/boom");
const NodeCache = require("node-cache");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} = require("@whiskeysockets/baileys");

const readline = require("readline");
const MAIN_LOGGER = require("@whiskeysockets/baileys/lib/Utils/logger").default;
const logger = MAIN_LOGGER.child({});
logger.level = "silent";

let sessionStartTime;
var qrcode = "./connection";

const usePairingCode = process.argv.includes("sim");

if (!usePairingCode && !fs.existsSync(`${qrcode}/creds.json`)) {
  console.log(
    colors.yellow(
      "Se você não tiver outro aparelho para ler o qrcode, você pode usar, ( sh start.sh sim ), sem os parenteses, e você conectará com código de emparelhamento, o novo modelo."
    )
  );
}

function coletarNumeros(inputString) {
  return inputString.replace(/\D/g, "");
}

const originalConsoleInfo = console.info;

console.info = function () {
  const message = util.format(...arguments);
  const forbiddenStrings = [
    "Closing session: SessionEntry",
    "Removing old closed session: SessionEntry {",
    "Another forbidden string",
    "Closing stale open session for new outgoing prekey bundle",
  ];
  if (forbiddenStrings.some((str) => message.includes(str))) {
    return;
  }
  originalConsoleInfo.apply(console, arguments);
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = (text) => new Promise((resolve) => rl.question(text, resolve));

const msgRetryCounterCache = new NodeCache();

async function INC() {
  const { state, saveCreds } = await useMultiFileAuthState(qrcode);
  const { version } = await fetchLatestBaileysVersion();

  const conn = makeWASocket({
    version,
    logger,
    browser: ["Ubuntu", "Chrome", "20.0.04"],
    printQRInTerminal: !usePairingCode,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    msgRetryCounterCache,
    syncFullHistory: false,
    defaultQueryTimeoutMs: undefined,
    generateHighQualityLinkPreview: true,
    keepAliveIntervalMs: 300000,
  });

  if (usePairingCode && !conn.authState.creds.registered) {
    const phoneNumber = await question(
      "Por favor insira o número que será usado como BOT. Com código do país e área, mas sem símbolos, somente números:\n"
    );
    let numerosColetados = coletarNumeros(phoneNumber);
    const code = await conn.requestPairingCode(numerosColetados);
    console.log(
      `Código de emparelhamento: ${code}\nVá no whatsapp que será o bot, em aparelhos conectados e clique em "Conectar um aparelho". Lá na parte inferior, clique em *Conectar com número de telefone*.`
    );
  }

  conn.ev.process(async (events) => {
    if (events["connection.update"]) {
      const update = events["connection.update"];

      const {
        connection,
        lastDisconnect,
        qr,
        isNewLogin,
        receivedPendingNotifications,
      } = update;

      const shouldReconnect = new Boom(lastDisconnect?.error)?.output
        .statusCode;

      switch (connection) {
        case "close": {
          if (shouldReconnect) {
            if (shouldReconnect == 428) {
              console.log(
                colors.yellow(
                  "Conexão caiu, irei ligar novamente, se continuar com este erro, provavelmente sua internet está caindo constantemente.."
                )
              );
            } else if (shouldReconnect == 401) {
              console.log(
                colors.red(
                  "O QRCODE DO BOT FOI DESCONECTADO, RE-LEIA O QRCODE DENOVO PARA CONECTAR"
                )
              );
              fs.remove(qrcode)
                .then(() => {
                  console.log("Qrcode excluído com sucesso");
                })
                .catch((err) => {
                  console.error(`Erro ao excluir o qrcode: ${err}`);
                });
            } else if (shouldReconnect == 515) {
              console.log(
                colors.gray("Restart Nescessario para estabilizar a conexão...")
              );
            } else if (shouldReconnect == 440) {
              return console.log(
                colors.gray(
                  "Está tendo um pequeno conflito, se isso aparecer mais de 4 vez, creio que há uma outra sessão aberta, ou o bot ligado em outro lugar, caso contrário ignore.."
                )
              );
            } else if (shouldReconnect == 503) {
              console.log(colors.grey("Erro desconhecido, code: 503"));
            } else if (shouldReconnect == 502) {
              console.log(colors.grey("PROBLEMAS COM A INTERNET..."));
            } else if (shouldReconnect == 408) {
              console.log(colors.gray("Conexão fraca..."));
            } else {
              console.log("Conexão Fechada _- POR: ", lastDisconnect?.error);
            }
            INC();
          }
          break;
        }

        case "connecting": {
          console.log(colors.green("CONECTANDO, AGUARDE..."));
          break;
        }

        case "open": {
          console.log(colors.green(`CONECTADO COM SUCESSO!`));
          rl.close();
          sessionStartTime = moment().tz("America/Sao_Paulo").unix();
          await conn.sendPresenceUpdate("available");
          break;
        }
      }
    }

    if (events["creds.update"]) {
      await saveCreds();
    }

    if (events["messages.upsert"]) {
      var upsert = events["messages.upsert"];
      const startWhats = require("./messages.js");
      sessionStartTim = upsert.messages.some(
        (i) => i.messageTimestamp > sessionStartTime
      );
      startWhats(upsert, conn, qrcode, sessionStartTim)
        .then(() => {})
        .catch((error) => {
          console.log("Erro no Bot:", String(error));
        });
    }
  });
}

INC().catch(async (e) => {
  console.log(colors.red("ERROR EM INICIAR.JS: " + e));
});

module.exports = INC;