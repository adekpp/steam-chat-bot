// Import dependencies
require("dotenv").config();
const SteamUser = require("steam-user");
const config = require("./config");
const cron = require("node-cron");

// Validate configuration
const requiredConfig = ['accountName', 'password', 'publicUsername'];
requiredConfig.forEach(key => {
  if (!config[key]) {
    throw new Error(`Missing required config key: ${key}`);
  }
});

// Initialize Steam client
const client = new SteamUser();

const logInOptions = {
  accountName: config.accountName,
  password: config.password,
};

// Log on to Steam
client.logOn(logInOptions);

client.on("loggedOn", () => {
  console.log("Bot logged on");
  client.setPersona(SteamUser.EPersonaState.Online, config.publicUsername);
  client.gamesPlayed("Counter-Strike 2");
});

// Error handling for client events
client.on("error", (err) => {
  console.error("Client error:", err);
});

// Initialize player lists
let list = [];
let spareList = [];

const clearList = () => {
  list = [];
  spareList = [];
};

const addToList = (userName) => {
  if (!list.includes(userName)) {
    if (list.length === 10) {
      spareList.push(userName);
      return `Gracz ${userName} został dodany do rezerwy. Lista graczy jest pełna`;
    } else {
      list.push(userName);
      return `Gracz ${userName} został dodany do listy`;
    }
  } else {
    return `Nie wal w chuja ${userName} jesteś już na liście!`;
  }
};

const removeFromList = (userName) => {
  if (!list.includes(userName)) {
    return;
  }
  list.splice(list.indexOf(userName), 1);
  return `Gracz ${userName} został usunięty z listy`;
};

const showList = () => {
  if (list.length === 0) {
    return `Lista graczy jest pusta`;
  } else {
    return `
    Lista graczy:\n ${list
      .map((user, index) => `${index + 1}. ${user}`)
      .join("\n")}\n
    \n 
    ${spareList.length ? `Rezerwa:\n ${spareList.join("\n")}` : ""}
    `;
  }
};

const commands = {
  "!gram": (userName) => addToList(userName),
  "!nie gram": (userName) => removeFromList(userName),
  "!lista": () => showList(),
  "!help": () => `
    Dostępne komendy:
    ---------------------\n
    !gram - dodaje gracza do listy
    !nie gram - usuwa gracza z listy
    !lista - wyświetla listę graczy \n
    ---------------------
    Lista będzie czyszczona codziennie o godzinie 00:01
  `,
};

const handleCommand = async (command, userName) => {
  if (commands[command]) {
    return commands[command](userName);
  }
};

// Retry function with exponential backoff
const retryWithBackoff = async (fn, retries = 3, delay = 1000) => {
  try {
    return await fn();
  } catch (err) {
    if (retries > 1) {
      console.log(`Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return retryWithBackoff(fn, retries - 1, delay * 2);
    } else {
      throw err;
    }
  }
};

client.chat.on("friendMessage", async (msgObj) => {
  const user = msgObj.steamid_friend.getSteamID64();
  try {
    await client.chat.sendFriendMessage(user, "Spierdalaj, nie gadam z tobą!");
  } catch (err) {
    console.error("Error sending friend message:", err);
  }
});

client.chat.on("chatMessage", async (msgObj) => {
  const steamID = msgObj.steamid_sender.getSteamID64();
  const message = msgObj.message;
  if (steamID) {
    try {
      const { personas } = await retryWithBackoff(() => client.getPersonas([steamID]));
      const userName = personas[steamID].player_name;
      let groupId = msgObj.chat_group_id,
        chatId = msgObj.chat_id,
        serverTimestamp = msgObj.server_timestamp,
        ordinal = msgObj.ordinal;

      if (message.startsWith("!")) {
        const response = await handleCommand(message, userName);
        if (response) {
          await client.chat.sendChatMessage(groupId, chatId, response);
        }
      }
    } catch (err) {
      console.error("Error handling chat message:", err);
    }
  }
});

cron.schedule("01 00 * * *", () => {
  clearList();
  console.log("Lista graczy została wyczyszczona");
});
