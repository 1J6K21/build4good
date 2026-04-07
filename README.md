# build4good

Mindful Macros is a full-stack, containerized web application focused on analyzing eating behavior rather than just tracking nutrition.

The system is built around a multi-agent workflow, where each agent operates as an independent component with defined schemas and contracts. Agents run in phases, producing structured outputs that include feedback, debugging insights, and test cases. This architecture makes the system easier to iterate on and reason about as complexity grows.

The application is containerized with Docker and deployed on Fly.io, where it runs as a managed instance with persistent volumes. This setup allows direct interaction with the running environment to execute scripts, seed data, and run scheduled jobs (e.g., daily data fetching) via cron-like processes.

For data ingestion, the app uses Puppeteer to responsibly scrape publicly available dining information and combines it with USDA nutrition datasets. This data is normalized and used to power the app’s evaluation logic.

The backend is designed to be lightweight and efficient, using JWT for authentication and SQLite for storage, enabling fast development and iteration while maintaining structure.

Overall, the project emphasizes system design, infrastructure control, and building reliable workflows across the full stack—from data collection to deployment.
