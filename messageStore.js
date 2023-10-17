const createInMemoryMessageStore = () => {
  const messages = [];

  const findMessagesForUser = (userID) => {
    const filtered = messages.filter(
      ({ from, to }) => from === userID || to === userID
    );
    console.log("filtered messages: ", filtered);

    return filtered;
  };

  const saveMessage = (message) => {
    messages.push(message);
    console.log("saving Messages", messages);
  };

  return { findMessagesForUser, saveMessage };
};

export default createInMemoryMessageStore;
