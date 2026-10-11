import app from "./server";

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {
  console.log(`Family Rummy Tracker API running on http://localhost:${PORT}`);
});