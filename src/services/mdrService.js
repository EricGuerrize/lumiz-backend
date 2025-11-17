const supabase = require('../db/supabase');
const mdrOcrService = require('./mdrOcrService');

class MdrService {
  async saveManualConfig({ phone, userId, bandeiras, tiposVenda, parcelas, provider }) {
    const payload = {
      phone,
      user_id: userId,
      source: 'manual',
      provider: provider ? provider.toLowerCase() : null,
      bandeiras: bandeiras || [],
      tipos_venda: tiposVenda || {},
      parcelas: parcelas || {},
      raw_payload: {
        bandeiras,
        tiposVenda,
        parcelas
      },
      status: 'pending_confirmation'
    };

    const { data, error } = await supabase
      .from('mdr_configs')
      .insert(payload)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  async requestOcr({ phone, userId, imageUrl, provider }) {
    const { data: job, error: jobError } = await supabase
      .from('ocr_jobs')
      .insert({
        phone,
        user_id: userId,
        provider: provider ? provider.toLowerCase() : null,
        source_url: imageUrl,
        status: 'processing'
      })
      .select()
      .single();

    if (jobError) {
      throw jobError;
    }

    try {
      const extraction = await mdrOcrService.extractRates({ imageUrl, provider });

      const { data: config, error: configError } = await supabase
        .from('mdr_configs')
        .insert({
          phone,
          user_id: userId,
          provider: extraction.provider,
          source: 'ocr',
          bandeiras: extraction.bandeiras,
          tipos_venda: extraction.tiposVenda,
          parcelas: extraction.parcelas,
          raw_payload: extraction,
          status: 'pending_review'
        })
        .select()
        .single();

      if (configError) {
        throw configError;
      }

      await supabase
        .from('ocr_jobs')
        .update({
          status: 'completed',
          extracted_data: extraction,
          updated_at: new Date().toISOString()
        })
        .eq('id', job.id);

      return { job, extraction, config };
    } catch (error) {
      await supabase
        .from('ocr_jobs')
        .update({
          status: 'failed',
          error: error.message,
          updated_at: new Date().toISOString()
        })
        .eq('id', job.id);

      throw error;
    }
  }

  async confirmConfig(configId, payload = {}) {
    const updatePayload = {
      status: 'confirmed',
      updated_at: new Date().toISOString()
    };

    if (payload.rawPayload) {
      updatePayload.raw_payload = payload.rawPayload;
    }

    const { data, error } = await supabase
      .from('mdr_configs')
      .update(updatePayload)
      .eq('id', configId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  async getLatestConfig(phone, userId) {
    let query = supabase
      .from('mdr_configs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1);

    if (userId) {
      query = query.eq('user_id', userId);
    } else {
      query = query.eq('phone', phone);
    }

    const { data, error } = await query.maybeSingle();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    return data || null;
  }

  async getJobs(phone, userId) {
    let query = supabase
      .from('ocr_jobs')
      .select('*')
      .order('created_at', { ascending: false });

    if (userId) {
      query = query.eq('user_id', userId);
    } else {
      query = query.eq('phone', phone);
    }

    const { data, error } = await query;

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    return data || [];
  }

  async getMetrics() {
    const { count: confirmed } = await supabase
      .from('mdr_configs')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'confirmed');

    return {
      confirmed: confirmed || 0
    };
  }
}

module.exports = new MdrService();

