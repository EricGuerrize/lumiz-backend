import mongoose from 'mongoose';

const UserDataSchema = new mongoose.Schema({
    name: String,
    email: String,
    age: Number,
    // Adicione outros campos conforme necessário
}, { timestamps: true });

export default mongoose.model('UserData', UserDataSchema);