// Import dependencies
require("dotenv").config();
const SteamUser = require("steam-user");
const config = require("./config");
const cron = require("node-cron");
const PocketBase = require("pocketbase/cjs");

// Validate configuration
const requiredConfig = ["accountName", "password", "publicUsername"];
requiredConfig.forEach((key) => {
  if (!config[key]) {
    throw new Error(`Missing required config key: ${key}`);
  }
});

// Initialize Steam client and PocketBase
const client = new SteamUser();
const pb = new PocketBase(config.database);

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

// Queue system
const commandQueue = [];
let isProcessingQueue = false;

const processQueue = async () => {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (commandQueue.length > 0) {
    const { command, name, steamID, groupId, chatId } = commandQueue.shift();
    try {
      const response = await handleCommand(command, name, steamID);
      if (response) {
        await client.chat.sendChatMessage(groupId, chatId, response);
      }
    } catch (err) {
      console.error("Error processing command from queue:", err);
    }
    await new Promise((resolve) => setTimeout(resolve, 500)); // Avoid hitting rate limits
  }

  isProcessingQueue = false;
};

const clearList = async () => {
  try {
    await pb
      .collection("players")
      .update({}, { isPlaying: false, isSpare: false });
    console.log("Player list cleared");
  } catch (err) {
    console.error("Error clearing list:", err);
  }
};

const addToList = async (steamID, playerName) => {
  console.log("Adding to list:", steamID, playerName);
  try {
    const activePlayers = await pb.collection("players").getFullList({
      filter: "isPlaying=true",
    });

    const data = {
      steamId: steamID,
      name: playerName,
      isPlaying: activePlayers.length <= 10,
      isSpare: activePlayers.length === 10,
    };

    try {
      const existingPlayer = await pb
        .collection("players")
        .getFirstListItem(`steamId="${steamID}"`);
      if (existingPlayer.isPlaying === true || existingPlayer.isSpare === true)
        return `${playerName} nie wal w ch*ja jesteś już na liście.`;

      await pb.collection("players").update(existingPlayer.id, data);
      return `Gracz ${playerName} dodany do ${
        data.isPlaying ? "listy" : "rezerwy"
      }.`;
    } catch (err) {
      if (err.status === 404) {
        console.log("addTolist", err);
      } else {
        throw err;
      }
    }
  } catch (err) {
    console.error("addTolist", err);
    return `Error adding to list: ${err.message}`;
  }
};

const removeFromList = async (steamID, playerName) => {
  try {
    const existingPlayer = await pb
      .collection("players")
      .getFirstListItem(`steamId="${steamID}"`);

    if (
      (existingPlayer.isPlaying === false) &
      (existingPlayer.isSpare === false)
    )
      return `${playerName} nie jest na liście.`;

    await pb
      .collection("players")
      .update(existingPlayer.id, { isPlaying: false, isSpare: false });
    return `${playerName} usunięty z listy.`;
  } catch (err) {
    console.error("Error removing from list:", err);
    return `Wystąpił błąd podczas usuwania z listy. Spróbuj ponownie.`;
  }
};

const showList = async () => {
  try {
    const players = await pb.collection("players").getFullList({
      filter: pb.filter("isPlaying = {:isPlaying} || isSpare = {:isSpare} ", {
        isPlaying: true,
        isSpare: true,
      }),
    });
    const activePlayers = players
      .filter((player) => player.isPlaying && !player.isSpare)
      .map((player, index) => `${index + 1}. ${player.name}`)
      .join("\n");
    const sparePlayers = players
      .filter((player) => player.isSpare)
      .map((player) => player.name)
      .join("\n");
    return players.length > 0
      ? `
      Lista graczy:\n${activePlayers}
      ${sparePlayers.length ? `\nRezerwa:\n${sparePlayers}` : ""}
    `
      : "Lista jest pusta";
  } catch (err) {
    console.error("Error showing list:", err);
    return `Error showing list: ${err.message}`;
  }
};

const commands = {
  "!gram": async (playerName, steamID) => addToList(steamID, playerName),
  "!nie gram": async (playerName, steamID) =>
    removeFromList(steamID, playerName),
  "!lista": () => showList(),
  "!help": () => `
    Dostępne komendy:
    ---------------------
    !gram - Dodaje gracza do listy
    !nie gram - Usuwa gracza z listy
    !lista - Pokazuje listę graczy
    ---------------------
    Lista będzie czyszczona codziennie o 00:01.
  `,
};

const handleCommand = async (command, playerName, steamID) => {
  if (commands[command]) {
    return commands[command](playerName, steamID);
  }
};

// Retry function with exponential backoff
const retryWithBackoff = async (fn, retries = 3, delay = 1000) => {
  try {
    return await fn();
  } catch (err) {
    if (retries > 1) {
      console.log(`Retrying in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return retryWithBackoff(fn, retries - 1, delay * 2);
    } else {
      throw err;
    }
  }
};

// Check and create user if not exist
const checkAndCreateUser = async (steamID) => {
  try {
    const player = await pb
      .collection("players")
      .getFirstListItem(`steamId="${steamID}"`);
    return player.name;
  } catch (err) {
    if (err.status === 404) {
      console.log("User does not exist, fetching persona...");
      const { personas } = await retryWithBackoff(() =>
        client.getPersonas([steamID])
      );
      const playerName = personas[steamID].player_name;
      const newPlayer = await pb
        .collection("players")
        .create({ steamId: steamID, name: playerName });
      return newPlayer.name;
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
      if (message.startsWith("!")) {
        let playerName = await checkAndCreateUser(steamID);

        let groupId = msgObj.chat_group_id,
          chatId = msgObj.chat_id;
        commandQueue.push({
          command: message,
          name: playerName,
          steamID,
          groupId,
          chatId,
        });
        console.log(commandQueue);
        processQueue();
      }
    } catch (err) {
      console.error("Error handling chat message:", err);
    }
  }
});

cron.schedule("01 00 * * *", () => {
  clearList();
  console.log("Player list cleared");
});
