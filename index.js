async function getNxTaskStatus(chatId) {
  try {
    const result =
      await supabaseRequest(
        `/rest/v1/rpc/get_nx_task_status`,
        {
          method: "POST",

          body: JSON.stringify({
            p_chat_id: Number(chatId)
          })
        }
      );

    return result || {};
  } catch (error) {
    console.error(
      "Task status error:",
      error.message
    );

    return {};
  }
}
