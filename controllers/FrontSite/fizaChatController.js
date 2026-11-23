// Fiza / Luna chat in the app and on the web (Nov 2026). The member talks to
// the assistant (and her coach) here; the conversation lives in the CRM
// (channel 'app'), which decides who answers (fithercrm src/routes/fizaChat.routes.js).
// The mobile app shows the assistant as "Luna" (assistant: "luna"); the web as Fiza.
//
//   GET  /users/fiza-chat
//   POST /users/fiza-chat  { message?, handoff?, assistant? }          send / ask for a coach
//   POST /users/fiza-chat  { ticket: true, message, category? }        open a support ticket from the chat
//
// Tickets: she can tap "Report a problem" (ticket: true), and when the assistant
// flags an app bug or a complaint, a ticket is opened for her automatically.
// Either way a short confirmation with the ticket number is added to the chat.
const ApiResponse = require("../../helper/ApiResponse");
const { User } = require("../../models");
const { crmCall } = require("../../helper/crmApi");
const { createTicketFor } = require("./appIssueController");

const AUTO_TICKET = { app_bug_complex: "APP_ISSUE", complaint: "OTHER" };

async function profile(userId) {
  const u = await User.findByPk(userId, { attributes: ["id", "firstName", "lastName", "email", "phone"] });
  return {
    name: u ? `${u.firstName || ""} ${u.lastName || ""}`.trim() || null : null,
    email: u ? u.email : null,
    phone: u ? u.phone : null,
  };
}

// Adds a line to her chat in the CRM; returns the chat message(s) it created.
async function note(userId, text, who, extra) {
  try {
    const d = await crmCall("POST", "/api/app/fiza/note", { app_user_id: String(userId), text, from: who, ...extra });
    return (d && d.messages) || [];
  } catch (e) {
    console.error("[fiza-chat] note:", e.response?.data || e.message);
    return [];
  }
}

const ticketLine = (t) =>
  `I've opened ticket #${t.id} for you. Our team will reply in Support tickets (and here) within 3 working days, usually much sooner.`;

exports.history = async (req, res) => {
  try {
    const data = await crmCall("GET", `/api/app/fiza/history?app_user_id=${encodeURIComponent(req.user.id)}`);
    return res.json(ApiResponse("1", "Chat", data));
  } catch (e) {
    console.error("[fiza-chat] history:", e.response?.data || e.message);
    return res.json(ApiResponse("0", "Chat is not available right now. Please try again.", {}));
  }
};

exports.send = async (req, res) => {
  const b = req.body || {};
  const message = String(b.message || "").trim().slice(0, 2000);
  const handoff = b.handoff === true || b.handoff === "true";
  const wantsTicket = b.ticket === true || b.ticket === "true";
  const assistant = b.assistant === "luna" ? "luna" : "fiza";
  if (!message && !handoff) return res.json(ApiResponse("0", "Write a message", {}));

  try {
    const who = await profile(req.user.id);

    // "Report a problem" from the chat → ticket, no AI reply needed.
    if (wantsTicket) {
      const ticket = await createTicketFor(req.user.id, {
        message: message.slice(0, 1000),
        category: b.category || "APP_ISSUE",
        source: "chat",
      });
      const messages = [
        ...(await note(req.user.id, message, "me", who)),
        ...(await note(req.user.id, ticketLine(ticket), "bot", who)),
      ];
      return res.json(ApiResponse("1", "Ticket opened", { status: "ticket", ticket: { id: ticket.id, status: ticket.status }, messages }));
    }

    const data = await crmCall("POST", "/api/app/fiza/message", {
      app_user_id: String(req.user.id),
      message,
      handoff,
      assistant,
      ...who,
    });

    // The assistant flagged an app bug / complaint → open a ticket for her too.
    const cat = data && AUTO_TICKET[data.escalate];
    if (cat && message) {
      try {
        const ticket = await createTicketFor(req.user.id, { message: message.slice(0, 1000), category: cat, source: "chat_auto" });
        data.ticket = { id: ticket.id, status: ticket.status };
        data.messages = [...(data.messages || []), ...(await note(req.user.id, ticketLine(ticket), "bot", who))];
      } catch (e) {
        console.error("[fiza-chat] auto ticket:", e.message);
      }
    }
    return res.json(ApiResponse("1", "Sent", data));
  } catch (e) {
    console.error("[fiza-chat] send:", e.response?.data || e.message);
    return res.json(ApiResponse("0", "Couldn't send right now. Please try again.", {}));
  }
};
