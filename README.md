# FormulaTrack Insights

Create me an app called (FormulaAcc) an app that acts as a telemetry dashboard. Here users upload csv filed of the sensors and it depects the values in graphs.



Build a professional and user-friendly Formula Student Telemetry Dashboard App with the following pages and features:



1. **Dashboard / Home Page**

   - Display an overview of the car’s telemetry data: max speed, average speed, max acceleration, and lap times.

   - Include tabs or cards for:

       - Speed Analysis

       - Acceleration Analysis

       - Temperature Analysis

       - Lap Time Calculator

   - Show summary metrics at the top in visually appealing cards with icons.

   - Use clear colors, charts, and modern UI design to make it look professional and intuitive.



2. **Data Upload / CSV Import Page**

   - Allow users to upload CSV files containing telemetry data.

   - Display a file preview or confirmation after upload.

   - Provide instructions for CSV format (columns: Time, Speed, Acceleration, Temperature).

   - Include a clear “Upload” button and progress indicator.

   - Automatically store uploaded data for use in graphs and calculations.



3. **Graph / Analysis Page**

   - Display line charts, bar charts, or trend graphs for speed, acceleration, and temperature.

   - Allow users to filter by time range or metric.

   - Highlight peak points (max speed, max acceleration, temperature spikes).

   - Include tooltips explaining each data point in simple terms.

   - Make charts interactive and visually appealing with colors and clear labels.



4. **AI Chat / Assistant Page**

   - Integrate a chat box where users can ask questions about uploaded data.

   - Example questions:

       - “What is the max speed?”  

       - “Explain this speed drop at 10 seconds.”  

       - “Predict lap time for next 50 meters.”  

   - AI responses should be concise, easy to understand, and helpful.

   - Include a toggle to show/hide AI chat for users who just want the dashboard.



5. **Lap Time Calculator Page**

   - Simple input form for track distance.

   - Calculate predicted lap time using average speed from uploaded data.

   - Display result prominently with clear formatting.

   - Optionally include a short explanation of the calculation.

   - Include a “Reset” button for new calculations.



**General Requirements**

- Use a clean, modern, and professional design with team branding (Formula Adamjee logo and colors).

- Make navigation intuitive between pages.

- Use visual cues and cards to make the app easy to understand at a glance.

- Ensure the app is mobile-friendly, fast, and engaging for team members.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://accformula.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/5ba09017-9ae0-4154-baef-3a08749b0de9).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
