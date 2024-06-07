require("dotenv").config();

const SteamUser = require("steam-user");
const SteamTotp = require("steam-totp");
const config = require("./config");
const cron = require("node-cron");

const client = new SteamUser();

const logInOptions = {
  accountName: config.accountName,
  password: config.password,
};

client.logOn(logInOptions);

client.on("loggedOn", () => {
  console.log("Bot logged on");

  client.setPersona(SteamUser.EPersonaState.Online, config.publicUsername);
  client.gamesPlayed('Counter-Strike 2');
});

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
  "!gram": (userName) => {
    return addToList(userName);
  },
  "!nie gram": (userName) => {
    return removeFromList(userName);
  },
  "!lista": () => {
    return showList();
  },
  "!help": () => {
    return `
    Dostępne komendy:
    ---------------------\n
    !gram - dodaje gracza do listy
    !nie gram - usuwa gracza z listy
    !lista - wyświetla listę graczy \n
    ---------------------
    Lista będzie czyszczona codziennie o godzinie 00:01
    `;
  },
};

const handleCommand = (command, userName) => {
  if (commands[command]) {
    return commands[command](userName);
  }
};

client.chat.on("friendMessage", function (msgObj) {
  const user = msgObj.steamid_friend.getSteamID64();

  client.chat.sendFriendMessage(user, "Spierdalaj, nie gadam z tobą!");
});

client.chat.on("chatMessage", function (msgObj) {
  let steamidObj = msgObj.steamid_sender;
  const message = msgObj.message;
  const user = steamidObj.getSteamID64();
  const userName = client.users[user].player_name;
  let groupId = msgObj.chat_group_id,
    chatId = msgObj.chat_id,
    serverTimestamp = msgObj.server_timestamp,
    ordinal = msgObj.ordinal;

  if (message.startsWith("!")) {
    const response = handleCommand(message, userName);
    if (response) {
      client.chat.sendChatMessage(groupId, chatId, response);
    }
  }
});

cron.schedule("01 00 * * *", () => {
  clearList();
  console.log("Lista graczy została wyczyszczona");
});
