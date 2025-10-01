import { useEffect, useState, useMemo } from "react"; // ✅ added useMemo
import {
    PieChart, Pie, Cell,
    BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
    LineChart, Line
} from "recharts";
import { WordCloud } from "@isoterik/react-word-cloud";

const BUCKET = process.env.REACT_APP_S3_BUCKET || "meddoc-structured";
const REGION = process.env.REACT_APP_S3_REGION || "us-east-1";
const FILE_KEY = "patients/patients_structured.json";
const S3_URL = `https://${BUCKET}.s3.${REGION}.amazonaws.com/${FILE_KEY}`;

export default function Dashboard() {
    const [patients, setPatients] = useState([]);
    const [err, setErr] = useState("");

    // --- Memoized callbacks ---
    const callbacks = useMemo(() => ({
        getWordColor: word => word.value > 50 ? "blue" : "red",
        onWordClick: console.log,
        onWordMouseOver: console.log,
        getWordTooltip: word => `${word.text} (${word.value}) [${word.value > 50 ? "good" : "bad"}]`,
    }), []);

    // --- Memoized data ---
    const genderData = useMemo(() => {
        const dist = patients.reduce((acc, p) => {
            if (p.gender) acc[p.gender] = (acc[p.gender] || 0) + 1;
            return acc;
        }, {});
        return Object.entries(dist).map(([g, count]) => ({ name: g, value: count }));
    }, [patients]);

    const ageData = useMemo(() => {
        const buckets = patients.reduce((acc, p) => {
            if (!p.age && p.age !== 0) return acc;
            let bucket = "";
            if (p.age < 20) bucket = "<20";
            else if (p.age < 40) bucket = "20-39";
            else if (p.age < 60) bucket = "40-59";
            else bucket = "60+";
            acc[bucket] = (acc[bucket] || 0) + 1;
            return acc;
        }, {});
        return Object.entries(buckets).map(([age, count]) => ({ age, patients: count }));
    }, [patients]);

    const diagnosisWords = useMemo(() => {
        const counts = {};
        patients.forEach(p => {
            (p.diagnoses || []).forEach(d => counts[d] = (counts[d] || 0) + 1);
        });
        return Object.entries(counts)
            .map(([text, value]) => ({ text: String(text), value: Number(value) }))
            .filter(w => w.value > 0);
    }, [patients]);

    const scaledWords = diagnosisWords.map(w => ({
        text: w.text,
        value: Math.max(w.value * 150, 20) // scale up, minimum font size 10
    }));


    const doctorData = useMemo(() => {
        const counts = {};
        patients.forEach(p => {
            if (p.doctor) counts[p.doctor] = (counts[p.doctor] || 0) + 1;
        });
        return Object.entries(counts).map(([doctor, records]) => ({ doctor, records }));
    }, [patients]);

    const COLORS = ["#8884d8", "#82ca9d", "#ffc658"];

    console.log("words", diagnosisWords);
    console.log("words cloud counts", diagnosisWords.length);

    // --- Effect to load patients ---
    useEffect(() => {
        async function loadPatients() {
            try {
                const res = await fetch(S3_URL);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                setPatients(Array.isArray(data) ? data : []);
            } catch (e) {
                console.error(e);
                setErr("❌ Failed to load patient data from S3.");
            }
        }
        loadPatients();
    }, []);

    // --- Early returns ---
    if (err) return <div>{err}</div>;
    if (!patients.length) return <div>⏳ Loading patients...</div>;

    // --- Total patients ---
    const totalPatients = patients.length;

    // --- UI ---
    return (
        <div className="dashboard-container">
            <h1 className="dashboard-title">📊 Patient Dashboard</h1>

            <div className="dashboard-kpi">
                <strong>Total Patients:</strong> {totalPatients}
            </div>

            <div className="dashboard-grid">
                {/* Gender Pie */}
                {genderData.length > 0 && (
                    <div className="dashboard-card">
                        <h3>Gender Distribution</h3>
                        <div className="chart-wrapper">
                            <PieChart width={400} height={300}>
                                <Pie
                                    data={genderData}
                                    cx="50%" cy="50%" outerRadius={100}
                                    dataKey="value" label
                                >
                                    {genderData.map((entry, i) => (
                                        <Cell key={`cell-${i}`} fill={COLORS[i % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip />
                            </PieChart>
                        </div>
                    </div>
                )}

                {/* Age Buckets */}
                {ageData.length > 0 && (
                    <div className="dashboard-card">
                        <h3>Age Distribution</h3>
                        <div className="chart-wrapper">
                            <BarChart width={400} height={300} data={ageData}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="age" />
                                <YAxis />
                                <Tooltip />
                                <Legend />
                                <Bar dataKey="patients" fill="#8884d8" />
                            </BarChart>
                        </div>
                    </div>
                )}

                {/* Doctor Records */}
{doctorData.length > 0 && (
  <div className="dashboard-card">
    <h3>Records by Doctor</h3>
    <div className="chart-wrapper">
      <BarChart
        width={500} 
        height={350} 
        data={doctorData} 
        margin={{ top: 20, right: 30, left: 20, bottom: 80 }} // more bottom margin
      >
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="doctor"
          angle={-35}            // rotate labels
          textAnchor="end"       // align rotated labels
          interval={0}           // show all labels
          tick={{ fontSize: 12, dy: 10 }} // add vertical offset
        />
        <YAxis />
        <Tooltip />
        <Legend verticalAlign="top" height={36} /> {/* move legend up */}
        <Bar dataKey="records" fill="#82ca9d" />
      </BarChart>
    </div>
  </div>
)}



                {/* Diagnoses Word Cloud */}
                <div className="dashboard-card">
                    <h3>Diagnoses Word Cloud</h3>
                    <div className="chart-wrapper" style={{ width: "400px", height: "300px" }}>
                        {diagnosisWords.length > 0 ? (
                            <WordCloud
                                words={scaledWords}
                                width={400}
                                height={300}
                                padding={2}
                                fontSizes={[14, 48]}
                                rotations={2}
                                rotationAngles={[-90, 0]}
                                colors={["#e26d6d", "#8884d8", "#82ca9d", "#ffc658"]}
                            />
                        ) : (
                            <p>No diagnosis data available</p>
                        )}
                    </div>
                </div>

            </div>
        </div>
    );
}

